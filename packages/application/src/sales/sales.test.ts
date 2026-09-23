import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@aquarela/domain";

import { beginPeriodClose, lockPeriodClose } from "../close";
import {
  createImportRun,
  disposeStagingRow,
  mapImportRows,
  stageImportRows,
  validateImportRun,
} from "../imports";
import { seedImportFixture } from "../imports/test-support";

import { getSalesTransaction } from "./get-sales-transaction";
import { DEFAULT_SALES_LIMIT, listSalesTransactions } from "./list-sales-transactions";
import { postImportRun } from "./post-import-run";
import { postTheoreticalConsumption } from "./post-theoretical-consumption";
import { reverseSalesLine } from "./reverse-sales-line";
import { correctSalesLine } from "./correct-sales-line";
import {
  FakeConsumptionStore,
  FakeCorrectSalesLineStore,
  FakeSalesStore,
  seedConsumptionFixture,
  seedImportRun,
  seedLockedPeriodCloseCover,
  seedReconciliationCover,
  seedSalesLine,
  stagingRow,
} from "./test-support";
import type { ConsumptionFixture } from "./test-support";
import type { NewSalesLineRecord, NewSalesTransactionRecord, SalesLineRecord } from "./types";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "actor-1";
const OCCURRED_AT = "2026-02-01T10:00:00.000Z";

function normalized(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    external_transaction_id: "txn-1",
    external_line_id: "line-1",
    occurred_at: OCCURRED_AT,
    currency: "NOK",
    quantity: "1.000000",
    gross_amount: "100.0000",
    net_amount: "80.0000",
    tax_amount: "20.0000",
    ...overrides,
  };
}

function transactionInput(
  externalTransactionId: string,
  occurredAt: string,
  overrides: {
    readonly organizationId?: string;
    readonly sourceSystem?: string;
    readonly locationId?: string | null;
  } = {},
): NewSalesTransactionRecord {
  return {
    organizationId: overrides.organizationId ?? ORG,
    locationId: overrides.locationId ?? null,
    channelId: null,
    sourceSystem: overrides.sourceSystem ?? "frontline",
    externalTransactionId,
    occurredAt,
    grossAmount: "100.0000",
    netAmount: null,
    taxAmount: null,
    discountAmount: null,
    refundAmount: null,
    currency: "NOK",
    importRunId: null,
  };
}

function lineInput(
  salesTransactionId: string,
  externalLineId: string,
  overrides: {
    readonly organizationId?: string;
    readonly productVariantId?: string | null;
    readonly quantity?: string;
    readonly optionKind?: string;
    readonly grossAmount?: string;
  } = {},
): NewSalesLineRecord {
  return {
    organizationId: overrides.organizationId ?? ORG,
    salesTransactionId,
    productVariantId: overrides.productVariantId ?? null,
    externalProductRef: null,
    sku: null,
    externalLineId,
    quantity: overrides.quantity ?? "1.000000",
    unitPrice: null,
    grossAmount: overrides.grossAmount ?? "100.0000",
    netAmount: null,
    taxAmount: null,
    appliedTaxRate: null,
    discountAmount: null,
    refundAmount: null,
    channelId: null,
    taxRuleId: null,
    parentLineId: null,
    optionKind: overrides.optionKind ?? "standalone",
    channelFeeBasis: null,
    mappingState: "mapped",
    reversalOfId: null,
  };
}

describe("postImportRun", () => {
  it("posts a validated run's staged rows and links each one to its sales line", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2", quantity: "2.000000" }),
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({
      importRunId,
      status: "posted",
      postedCount: 2,
      notPostedCount: 0,
      transactionCount: 1,
      includedLineCount: 0,
    });
    expect(store.salesTransactions.size).toBe(1);
    expect(store.salesLines.size).toBe(2);
    const transaction = [...store.salesTransactions.values()][0]!;
    expect(transaction).toMatchObject({
      organizationId: ORG,
      sourceSystem: "frontline",
      externalTransactionId: "txn-1",
      occurredAt: OCCURRED_AT,
      currency: "NOK",
      importRunId,
    });
    // Both rows carry gross 100.0000, so the header sums to 200.0000.
    expect(transaction.grossAmount).toBe("200.0000");
    for (const rowId of rowIds) {
      expect(stagingRow(store, rowId).linkedSalesLineId).not.toBeNull();
    }
    expect(store.importRuns.get(importRunId)!.rowCounts).toMatchObject({
      posted: 2,
      not_posted: 0,
    });
    expect(store.auditEvents.map((event) => event.action)).toContain("sales.import_run.posted");
  });

  it("persists product_variant_id from the staging row's normalized jsonb (DEC-113)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          {
            sourceRowNo: 1,
            normalized: normalized({ product_variant_id: "variant-1" }),
          },
          { sourceRowNo: 2, normalized: normalized({ external_line_id: "line-2" }) },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });
    expect(result).toMatchObject({ status: "posted", postedCount: 2 });

    const lines = [...store.salesLines.values()];
    const withVariant = lines.find((line) => line.externalLineId === "line-1")!;
    const withoutVariant = lines.find((line) => line.externalLineId === "line-2")!;
    expect(withVariant.productVariantId).toBe("variant-1");
    expect(withoutVariant.productVariantId).toBeNull();
    // Both rows still post and link, variant or not.
    for (const rowId of rowIds) {
      expect(stagingRow(store, rowId).linkedSalesLineId).not.toBeNull();
    }
  });

  it("marks a run partially_posted when some staged rows cannot post (DEC-025)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2" }),
            mappingState: "conflict",
            errorCode: "mapping_conflict",
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({
      status: "partially_posted",
      postedCount: 1,
      notPostedCount: 1,
      transactionCount: 1,
    });
    expect(store.salesLines.size).toBe(1);
    expect(stagingRow(store, rowIds[0]!).linkedSalesLineId).not.toBeNull();
    expect(stagingRow(store, rowIds[1]!).linkedSalesLineId).toBeNull();
  });

  it("posts partially under an explicit allow_partial snapshot, as the default does (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "allow_partial" },
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2" }),
            mappingState: "conflict",
            errorCode: "mapping_conflict",
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({
      status: "partially_posted",
      postedCount: 1,
      notPostedCount: 1,
    });
    expect(store.salesLines.size).toBe(1);
    expect(stagingRow(store, rowIds[0]!).linkedSalesLineId).not.toBeNull();
    expect(stagingRow(store, rowIds[1]!).linkedSalesLineId).toBeNull();
  });

  it("posts partially under a whitespace-only policy snapshot, as the default does (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "   " },
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2" }),
            mappingState: "unmapped",
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({
      status: "partially_posted",
      postedCount: 1,
      notPostedCount: 1,
    });
    expect(store.salesLines.size).toBe(1);
    expect(stagingRow(store, rowIds[0]!).linkedSalesLineId).not.toBeNull();
    expect(stagingRow(store, rowIds[1]!).linkedSalesLineId).toBeNull();
  });

  it("all_or_nothing refuses to post when a row is unresolved, writing nothing (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "all_or_nothing" },
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2" }),
            mappingState: "conflict",
            errorCode: "mapping_conflict",
          },
        ],
      },
    );
    const updateSpy = vi.spyOn(store, "updateImportRun");

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/all_or_nothing posting refused.*source rows 2/);

    expect(store.salesTransactions.size).toBe(0);
    expect(store.salesLines.size).toBe(0);
    expect(store.importRuns.get(importRunId)!.status).toBe("validated");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("all_or_nothing posts when the only unresolved row has an approved disposition (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "all_or_nothing" },
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2" }),
            mappingState: "unmapped",
          },
        ],
      },
    );
    await store.createImportDisposition({
      stagingRowId: rowIds[1]!,
      disposition: "unmapped",
      reason: null,
      actorId: ACTOR,
    });

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({
      status: "partially_posted",
      postedCount: 1,
      notPostedCount: 1,
      transactionCount: 1,
    });
    expect(store.salesLines.size).toBe(1);
    expect(stagingRow(store, rowIds[0]!).linkedSalesLineId).not.toBeNull();
    expect(stagingRow(store, rowIds[1]!).linkedSalesLineId).toBeNull();
  });

  it("drives all_or_nothing end-to-end from upload through disposition to partial posting (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const fixture = seedImportFixture(store);

    const created = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      profileVersion: "v1",
      fileHash: "hash-integration-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-28",
      postingPolicy: "all_or_nothing",
    });
    expect(created.status).toBe("uploaded");

    await stageImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: created.importRunId,
      rows: [
        { sourceRowNo: 1, raw: {}, normalized: normalized({ sku: fixture.itemSku }) },
        {
          sourceRowNo: 2,
          raw: {},
          normalized: normalized({ external_line_id: "line-2", currency: "USD" }),
        },
      ],
    });

    const validated = await validateImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: created.importRunId,
      rules: { expectedCurrency: "NOK" },
    });
    expect(validated).toMatchObject({ status: "needs_review", errorCount: 1 });
    const invalidRowId = validated.issues[0]!.stagingRowId;

    const mapped = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: created.importRunId,
      sourceSystem: fixture.sourceSystem,
      entityType: "item",
    });
    expect(mapped).toMatchObject({ mappedCount: 1, skippedCount: 1 });

    await disposeStagingRow(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: created.importRunId,
      stagingRowId: invalidRowId,
      disposition: "rejected",
      reason: "currency mismatch",
    });

    const result = await postImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: created.importRunId,
    });

    expect(result).toMatchObject({
      importRunId: created.importRunId,
      status: "partially_posted",
      postedCount: 1,
      notPostedCount: 1,
      transactionCount: 1,
    });
    expect(store.salesLines.size).toBe(1);
    const rows = await store.listImportStagingRows({
      organizationId: fixture.organizationId,
      importRunId: created.importRunId,
    });
    expect(rows.find((row) => row.sourceRowNo === 1)!.linkedSalesLineId).not.toBeNull();
    expect(rows.find((row) => row.sourceRowNo === 2)!.linkedSalesLineId).toBeNull();
    expect(store.importRuns.get(created.importRunId)!.rowCounts).toMatchObject({
      posted: 1,
      not_posted: 1,
    });
  });

  it("all_or_nothing posts normally when every row is postable (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "all_or_nothing" },
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-2", quantity: "2.000000" }),
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({ status: "posted", postedCount: 2, notPostedCount: 0 });
    for (const rowId of rowIds) {
      expect(stagingRow(store, rowId).linkedSalesLineId).not.toBeNull();
    }
  });

  it("all_or_nothing treats already-linked rows as resolved on replay (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "all_or_nothing" },
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );
    const existingTransaction = await store.createSalesTransaction(
      transactionInput("txn-1", OCCURRED_AT),
    );
    const existingLine = await store.createSalesLine(lineInput(existingTransaction.id, "line-1"));
    await store.updateImportStagingRow(rowIds[0]!, { linkedSalesLineId: existingLine.id });

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({ status: "posted", postedCount: 1, notPostedCount: 0 });
    // Nothing new was written: the already-linked rows are resolved.
    expect(store.salesTransactions.size).toBe(1);
    expect(store.salesLines.size).toBe(1);
  });

  it("rejects a corrupt posting-policy snapshot instead of defaulting (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: "best_effort" },
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/best_effort/);
    expect(store.salesTransactions.size).toBe(0);
    expect(store.salesLines.size).toBe(0);
  });

  it("rejects a non-string posting-policy snapshot as corrupt rather than coercing it (DEC-082)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        diagnostics: { posting_policy: ["all_or_nothing"] },
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/non-string posting policy: \["all_or_nothing"\]/);
    expect(store.salesTransactions.size).toBe(0);
    expect(store.salesLines.size).toBe(0);
  });

  it("refuses a run that is not validated and writes nothing (DEC-025)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        status: "uploaded",
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/not open for posting/);
    expect(store.salesTransactions.size).toBe(0);
    expect(store.salesLines.size).toBe(0);
  });

  it("replays onto the existing external keys instead of duplicating the rows (SALE-003)", async () => {
    const store = new FakeSalesStore();
    const { importRunId, rowIds } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );
    const existingTransaction = await store.createSalesTransaction(
      transactionInput("txn-1", OCCURRED_AT),
    );
    const existingLine = await store.createSalesLine(lineInput(existingTransaction.id, "line-1"));

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({ status: "posted", postedCount: 1, transactionCount: 1 });
    // Nothing new was written: the pre-existing transaction/line were reused.
    expect(store.salesTransactions.size).toBe(1);
    expect(store.salesLines.size).toBe(1);
    expect(stagingRow(store, rowIds[0]!).linkedSalesLineId).toBe(existingLine.id);
  });

  it("keeps included lines but excludes them from the header totals (DEC-043)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({
              external_line_id: "line-included",
              option_kind: "included",
              parent_external_line_id: "line-1",
              gross_amount: "50.0000",
            }),
          },
        ],
      },
    );

    const result = await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    expect(result).toMatchObject({ status: "posted", includedLineCount: 1, postedCount: 2 });
    const transaction = [...store.salesTransactions.values()][0]!;
    expect(transaction.grossAmount).toBe("100.0000");
    const included = [...store.salesLines.values()].find(
      (line) => line.externalLineId === "line-included",
    )!;
    expect(included).toMatchObject({ optionKind: "included", grossAmount: "50.0000" });
    expect(store.salesLines.size).toBe(2);
  });

  it("links an attached option to its parent line and sums it into the header (DEC-043)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({
              external_line_id: "line-add",
              option_kind: "attached",
              parent_external_line_id: "line-1",
              gross_amount: "20.0000",
            }),
          },
        ],
      },
    );

    await postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId });

    const parent = [...store.salesLines.values()].find((line) => line.externalLineId === "line-1")!;
    const attached = [...store.salesLines.values()].find(
      (line) => line.externalLineId === "line-add",
    )!;
    expect(attached.parentLineId).toBe(parent.id);
    expect(attached.optionKind).toBe("attached");
    expect([...store.salesTransactions.values()][0]!.grossAmount).toBe("120.0000");
  });

  it("rejects an attached option whose parent line is missing (DEC-043)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({
              external_line_id: "line-add",
              option_kind: "attached",
              parent_external_line_id: "line-nope",
            }),
          },
        ],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/parent line/);
  });

  it("rejects an unknown option_kind rather than normalizing it (DEC-043)", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [{ sourceRowNo: 1, normalized: normalized({ option_kind: "mystery" }) }],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/unknown option_kind/);
    expect(store.salesTransactions.size).toBe(0);
  });

  it("rejects mixed currencies inside one external transaction", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [
          { sourceRowNo: 1, normalized: normalized() },
          {
            sourceRowNo: 2,
            normalized: normalized({ external_line_id: "line-usd", currency: "USD" }),
          },
        ],
      },
    );

    await expect(
      postImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/mixed currencies/);
  });

  it("returns not found for another organization's run", async () => {
    const store = new FakeSalesStore();
    const { importRunId } = await seedImportRun(
      store,
      { organizationId: ORG },
      {
        rows: [{ sourceRowNo: 1, normalized: normalized() }],
      },
    );

    await expect(
      postImportRun(store, { organizationId: OTHER_ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(DomainError);
  });
});

function recipeKey(organizationId: string, productVariantId: string, locationId: string): string {
  // Mirrors the private `variantKey` in `./test-support`.
  return `${organizationId}\u0000${productVariantId}\u0000${locationId}`;
}

async function seedBalance(
  store: FakeConsumptionStore,
  fixture: ConsumptionFixture,
  itemId: string,
  quantityOnHand = "100.000000",
): Promise<void> {
  const key = {
    organizationId: fixture.organizationId,
    itemId,
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    lotId: null,
  };
  const at = new Date("2026-01-01T00:00:00.000Z");
  await store.lockStockBalance(key, at);
  await store.saveStockBalance(key, {
    quantityOnHand,
    valueOnHand: "100.0000",
    avgUnitCost: "1.0000",
    asOf: at,
  });
}

function seedRecipe(store: FakeConsumptionStore, fixture: ConsumptionFixture): void {
  store.variantRecipes.set(
    recipeKey(fixture.organizationId, fixture.productVariantId, fixture.locationId),
    {
      recipeVersionId: "recipe-version-1",
      usableYieldRate: "1.000000",
      components: [
        { itemId: fixture.itemId, quantityPerOutput: "0.500000", lossFactor: "1.000000" },
        { itemId: fixture.secondItemId, quantityPerOutput: "2.000000", lossFactor: "1.000000" },
      ],
    },
  );
}

describe("postTheoreticalConsumption", () => {
  async function setup(): Promise<{
    store: FakeConsumptionStore;
    fixture: ConsumptionFixture;
  }> {
    const store = new FakeConsumptionStore();
    const fixture = seedConsumptionFixture(store);
    await seedBalance(store, fixture, fixture.itemId);
    await seedBalance(store, fixture, fixture.secondItemId);
    return { store, fixture };
  }

  it("explodes the day's lines through the recipe and posts one atomic batch per sales line", async () => {
    const { store, fixture } = await setup();
    seedRecipe(store, fixture);
    const line = await seedSalesLine(store, fixture, {
      externalTransactionId: "txn-1",
      externalLineId: "line-1",
      occurredAt: "2026-02-01T10:00:00.000Z",
      quantity: "2.000000",
    });

    const result = await postTheoreticalConsumption(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      occurredOn: "2026-02-01",
      storageAreaId: fixture.storageAreaId,
    });

    expect(result).toMatchObject({
      locationId: fixture.locationId,
      occurredOn: "2026-02-01",
      salesLineCount: 1,
      consumedLineCount: 1,
      replayed: false,
    });
    expect(result.movementIds).toHaveLength(2);
    expect(store.stockMovements.size).toBe(2);
    for (const movement of store.stockMovements.values()) {
      expect(movement).toMatchObject({
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: line.id,
        occurredAt: "2026-02-01T00:00:00.000Z",
      });
    }
    const itemMovement = [...store.stockMovements.values()].find(
      (movement) => movement.itemId === fixture.itemId,
    )!;
    const componentMovement = [...store.stockMovements.values()].find(
      (movement) => movement.itemId === fixture.secondItemId,
    )!;
    expect(itemMovement.quantityDelta).toBe("-1.000000");
    expect(componentMovement.quantityDelta).toBe("-4.000000");
    expect(store.audits.map((event) => event.action)).toContain("sales.consumption.posted");
  });

  it("is idempotent per (location, date) and does not double-count the consumption", async () => {
    const { store, fixture } = await setup();
    seedRecipe(store, fixture);
    await seedSalesLine(store, fixture, {
      externalTransactionId: "txn-1",
      externalLineId: "line-1",
      occurredAt: "2026-02-01T10:00:00.000Z",
      quantity: "2.000000",
    });
    const input = {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      occurredOn: "2026-02-01",
      storageAreaId: fixture.storageAreaId,
    } as const;

    await postTheoreticalConsumption(store, input);
    const replay = await postTheoreticalConsumption(store, input);

    expect(replay.replayed).toBe(true);
    expect(replay.movementIds).toHaveLength(2);
    expect(store.stockMovements.size).toBe(2);
    const balance = await store.findStockBalance({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      locationId: fixture.locationId,
      storageAreaId: fixture.storageAreaId,
      lotId: null,
    });
    expect(balance?.quantityOnHand).toBe("99.000000");
  });

  it("skips variants with no effective recipe and reports them", async () => {
    const { store, fixture } = await setup();
    // DEC-066+ (open point A1, DEC-009): the consumption grain is daily per
    // location while `source_id` is a single `sales_line`; this asserts the
    // implemented behaviour, not a resolved rule.
    await seedSalesLine(store, fixture, {
      externalTransactionId: "txn-1",
      externalLineId: "line-retail",
      occurredAt: "2026-02-01T10:00:00.000Z",
      quantity: "1.000000",
      productVariantId: "variant-retail",
    });
    await seedSalesLine(store, fixture, {
      externalTransactionId: "txn-2",
      externalLineId: "line-null",
      occurredAt: "2026-02-01T11:00:00.000Z",
      quantity: "1.000000",
      productVariantId: null,
    });

    const result = await postTheoreticalConsumption(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      occurredOn: "2026-02-01",
      storageAreaId: fixture.storageAreaId,
    });

    expect(result).toMatchObject({
      salesLineCount: 2,
      consumedLineCount: 0,
      skippedVariantIds: ["variant-retail"],
      replayed: false,
    });
    expect(result.movementIds).toHaveLength(0);
    expect(store.stockMovements.size).toBe(0);
  });

  it("rejects a location that is not in the organization", async () => {
    const { store, fixture } = await setup();
    await expect(
      postTheoreticalConsumption(store, {
        organizationId: OTHER_ORG,
        actorId: "actor",
        locationId: fixture.locationId,
        occurredOn: "2026-02-01",
        storageAreaId: fixture.storageAreaId,
      }),
    ).rejects.toThrow(/location not found/);
  });

  it("rejects a storage area that does not belong to the location", async () => {
    const { store, fixture } = await setup();
    store.storageAreas.set("area-other", {
      id: "area-other",
      organizationId: fixture.organizationId,
      locationId: fixture.otherLocationId,
      code: "DRY-2",
      name: "Other dry store",
      kind: "dry_store",
      isTransit: false,
    });

    await expect(
      postTheoreticalConsumption(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: fixture.locationId,
        occurredOn: "2026-02-01",
        storageAreaId: "area-other",
      }),
    ).rejects.toThrow(/does not belong to the location/);
  });

  it("rejects an idempotency key containing ':' and an invalid date", async () => {
    const { store, fixture } = await setup();
    await expect(
      postTheoreticalConsumption(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: fixture.locationId,
        occurredOn: "2026-02-01",
        storageAreaId: fixture.storageAreaId,
        idempotencyKey: "bad:key",
      }),
    ).rejects.toThrow(/must not contain/);
    await expect(
      postTheoreticalConsumption(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: fixture.locationId,
        occurredOn: "01-02-2026",
        storageAreaId: fixture.storageAreaId,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("sales transaction reads", () => {
  it("pages newest first, filters by source/location and is organization-scoped", async () => {
    const store = new FakeSalesStore();
    await store.createSalesTransaction(transactionInput("txn-a", "2026-01-01T10:00:00.000Z"));
    await store.createSalesTransaction(
      transactionInput("txn-b", "2026-01-02T10:00:00.000Z", { sourceSystem: "wolt" }),
    );
    await store.createSalesTransaction(
      transactionInput("txn-c", "2026-01-03T10:00:00.000Z", { locationId: "loc-1" }),
    );
    await store.createSalesTransaction(
      transactionInput("txn-other", "2026-01-04T10:00:00.000Z", { organizationId: OTHER_ORG }),
    );

    const page = await listSalesTransactions(store, { organizationId: ORG, limit: 2 });
    expect(page.limit).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.transactions.map((row) => row.externalTransactionId)).toEqual(["txn-c", "txn-b"]);

    const next = await listSalesTransactions(store, { organizationId: ORG, limit: 2, offset: 2 });
    expect(next.hasMore).toBe(false);
    expect(next.transactions.map((row) => row.externalTransactionId)).toEqual(["txn-a"]);

    const bySource = await listSalesTransactions(store, {
      organizationId: ORG,
      sourceSystem: "wolt",
    });
    expect(bySource.transactions.map((row) => row.externalTransactionId)).toEqual(["txn-b"]);

    const byLocation = await listSalesTransactions(store, {
      organizationId: ORG,
      locationId: "loc-1",
    });
    expect(byLocation.transactions.map((row) => row.externalTransactionId)).toEqual(["txn-c"]);

    expect((await listSalesTransactions(store, { organizationId: OTHER_ORG })).limit).toBe(
      DEFAULT_SALES_LIMIT,
    );
  });

  it("validates limit and offset bounds", async () => {
    const store = new FakeSalesStore();
    await expect(listSalesTransactions(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(listSalesTransactions(store, { organizationId: ORG, limit: 201 })).rejects.toThrow(
      DomainError,
    );
    await expect(listSalesTransactions(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });

  it("gets one transaction with its lines and hides other organizations' rows", async () => {
    const store = new FakeSalesStore();
    const transaction = await store.createSalesTransaction(transactionInput("txn-1", OCCURRED_AT));
    const first = await store.createSalesLine(lineInput(transaction.id, "line-1"));
    await store.createSalesLine(lineInput(transaction.id, "line-2"));

    const detail = await getSalesTransaction(store, {
      organizationId: ORG,
      salesTransactionId: transaction.id,
    });
    expect(detail?.transaction.id).toBe(transaction.id);
    expect(detail?.lines).toHaveLength(2);

    expect(
      await getSalesTransaction(store, {
        organizationId: OTHER_ORG,
        salesTransactionId: transaction.id,
      }),
    ).toBeUndefined();
    expect(first.id).toBeDefined();
  });

  it("rejects a blank transaction id", async () => {
    const store = new FakeSalesStore();
    await expect(
      getSalesTransaction(store, { organizationId: ORG, salesTransactionId: "  " }),
    ).rejects.toThrow(DomainError);
  });
});

describe("reverseSalesLine", () => {
  async function seedReversibleLine(store: FakeSalesStore): Promise<SalesLineRecord> {
    const transaction = await store.createSalesTransaction(transactionInput("txn-1", OCCURRED_AT));
    return store.createSalesLine({
      organizationId: ORG,
      salesTransactionId: transaction.id,
      productVariantId: "variant-1",
      externalProductRef: "ext-ref",
      sku: "SKU-1",
      externalLineId: "line-1",
      quantity: "2.500000",
      unitPrice: "10.0000",
      grossAmount: "25.0000",
      netAmount: "20.0000",
      taxAmount: "5.0000",
      appliedTaxRate: "0.250000",
      discountAmount: "1.0000",
      refundAmount: "0.5000",
      channelId: "channel-1",
      taxRuleId: "tax-rule-1",
      parentLineId: null,
      optionKind: "standalone",
      channelFeeBasis: "net",
      mappingState: "mapped",
      reversalOfId: null,
    });
  }

  it("writes a new negated line in the same transaction and never edits the original (DEC-073)", async () => {
    const store = new FakeSalesStore();
    const line = await seedReversibleLine(store);

    const result = await reverseSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });

    expect(store.salesLines.size).toBe(2);
    // The original is untouched: the same object identity and exact values.
    expect(store.salesLines.get(line.id)).toEqual(line);

    const reversal = store.salesLines.get(result.reversalSalesLineId)!;
    expect(reversal.salesTransactionId).toBe(line.salesTransactionId);
    expect(reversal.reversalOfId).toBe(line.id);
    // Null so the unique `(transaction, external_line_id)` key is not violated.
    expect(reversal.externalLineId).toBeNull();
    // Every quantity/money field is mirrored exactly and negative.
    expect(reversal).toMatchObject({
      quantity: "-2.500000",
      unitPrice: "-10.0000",
      grossAmount: "-25.0000",
      netAmount: "-20.0000",
      taxAmount: "-5.0000",
      discountAmount: "-1.0000",
      refundAmount: "-0.5000",
      // Identity/classification fields are copied verbatim, never negated.
      productVariantId: line.productVariantId,
      externalProductRef: line.externalProductRef,
      sku: line.sku,
      appliedTaxRate: line.appliedTaxRate,
      channelId: line.channelId,
      taxRuleId: line.taxRuleId,
      parentLineId: line.parentLineId,
      optionKind: line.optionKind,
      channelFeeBasis: line.channelFeeBasis,
      mappingState: line.mappingState,
    });

    const audit = store.auditEvents.find((event) => event.action === "sales.sales_line.reversed");
    expect(audit).toMatchObject({
      entityType: "sales_line",
      entityId: result.reversalSalesLineId,
      after: {
        reversal_of_id: line.id,
        reason_code: "customer-refund",
        sales_line_id: result.reversalSalesLineId,
      },
    });
  });

  it("rejects a second reversal of the same line", async () => {
    const store = new FakeSalesStore();
    const line = await seedReversibleLine(store);
    const input = {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    };

    await reverseSalesLine(store, input);
    await expect(reverseSalesLine(store, input)).rejects.toThrow(/already reversed/);
    expect(store.salesLines.size).toBe(2);
  });

  it("rejects reversing a reversal line", async () => {
    const store = new FakeSalesStore();
    const line = await seedReversibleLine(store);
    const result = await reverseSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });

    await expect(
      reverseSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: result.reversalSalesLineId,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/cannot itself be reversed/);
    expect(store.salesLines.size).toBe(2);
  });

  it("rejects a missing or blank reasonCode and writes nothing", async () => {
    const store = new FakeSalesStore();
    const line = await seedReversibleLine(store);

    await expect(
      reverseSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "   ",
      }),
    ).rejects.toThrow(/reasonCode is required/);
    expect(store.salesLines.size).toBe(1);
  });

  it("hides a line that is missing or in another organization", async () => {
    const store = new FakeSalesStore();
    const line = await seedReversibleLine(store);

    await expect(
      reverseSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: "missing",
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/sales line not found in organization/);
    await expect(
      reverseSalesLine(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/sales line not found in organization/);
    expect(store.salesLines.size).toBe(1);
  });
});

describe("correctSalesLine", () => {
  async function seedCorrectableLine(
    store: FakeCorrectSalesLineStore,
    options: { readonly movements?: number; readonly locationId?: string | null } = {},
  ): Promise<{ line: SalesLineRecord; movementIds: string[] }> {
    const transaction = await store.createSalesTransaction(
      transactionInput("txn-1", OCCURRED_AT, { locationId: options.locationId ?? null }),
    );
    const line = await store.createSalesLine(lineInput(transaction.id, "line-1"));
    const movementIds: string[] = [];
    const count = options.movements ?? 2;
    for (let index = 0; index < count; index += 1) {
      const movement = await store.inventory.createStockMovement({
        organizationId: ORG,
        locationId: "loc",
        storageAreaId: "area",
        itemId: `item-${index}`,
        lotId: null,
        movementType: "sale_consumption",
        quantityDelta: "-1.000000",
        unitId: "unit",
        unitCost: null,
        valueDelta: "-5.0000",
        currency: "NOK",
        sourceType: "sales_line",
        sourceId: line.id,
        reversalOfId: null,
        occurredAt: OCCURRED_AT,
        postedBy: ACTOR,
        reasonCode: null,
        idempotencyKey: null,
      });
      movementIds.push(movement.id);
    }
    return { line, movementIds };
  }

  /** A blocked reversal writes nothing: no line, no movement reversal, no audit. */
  function assertNothingPosted(
    store: FakeCorrectSalesLineStore,
    line: SalesLineRecord,
    movementIds: readonly string[],
  ): void {
    expect(store.salesLines.size).toBe(1);
    expect(store.salesLines.has(line.id)).toBe(true);
    expect(store.inventory.stockMovements.size).toBe(movementIds.length);
    for (const movementId of movementIds) {
      expect(
        [...store.inventory.stockMovements.values()].filter(
          (movement) => movement.reversalOfId === movementId,
        ),
      ).toHaveLength(0);
    }
    expect(store.auditEvents).toHaveLength(0);
  }

  it("reverses the line and each of its sales_line movements exactly once (DEC-116)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store);

    const result = await correctSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });

    // The line-level reversal: a new negated line, the original untouched.
    expect(store.salesLines.size).toBe(2);
    expect(store.salesLines.get(line.id)).toEqual(line);
    expect(store.salesLines.get(result.reversalSalesLineId)?.reversalOfId).toBe(line.id);

    // Each original movement is reversed exactly once, and the reversal copies
    // the original's source so the line's ledger cost nets to zero.
    expect(result.reversedMovementIds).toHaveLength(movementIds.length);
    for (const movementId of movementIds) {
      const reversals = [...store.inventory.stockMovements.values()].filter(
        (movement) => movement.reversalOfId === movementId,
      );
      expect(reversals).toHaveLength(1);
      expect(reversals[0]).toMatchObject({
        sourceType: "sales_line",
        sourceId: line.id,
        quantityDelta: "1.000000",
        valueDelta: "5.0000",
      });
    }
    expect(result.revaluationMovementIds).toEqual([]);

    // The line-reversal audit fact is written (`DEC-073`).
    expect(store.auditEvents.some((event) => event.action === "sales.sales_line.reversed")).toBe(
      true,
    );
  });

  it("reverses a line with no consumption movements and returns an empty list", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store, { movements: 0 });

    const result = await correctSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });

    expect(result.reversedMovementIds).toEqual([]);
    expect(result.revaluationMovementIds).toEqual([]);
    expect(store.salesLines.size).toBe(2);
  });

  it("reverses only the un-reversed originals of a partially-reversed line (DEC-116)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store);
    const alreadyReversed = movementIds[0]!;
    const stillCorrectable = movementIds[1]!;
    // A prior partial correction: one original already has its reversal.
    await store.inventory.createStockMovement({
      organizationId: ORG,
      locationId: "loc",
      storageAreaId: "area",
      itemId: "item-0",
      lotId: null,
      movementType: "correction",
      quantityDelta: "1.000000",
      unitId: "unit",
      unitCost: null,
      valueDelta: "5.0000",
      currency: "NOK",
      sourceType: "sales_line",
      sourceId: line.id,
      reversalOfId: alreadyReversed,
      occurredAt: OCCURRED_AT,
      postedBy: ACTOR,
      reasonCode: "customer-refund",
      idempotencyKey: `reversal:${alreadyReversed}`,
    });

    const result = await correctSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });

    // Only the still-correctable original is reversed, and the line is reversed.
    expect(result.reversedMovementIds).toHaveLength(1);
    const newReversal = [...store.inventory.stockMovements.values()].find(
      (movement) => movement.reversalOfId === stillCorrectable,
    );
    expect(result.reversedMovementIds[0]).toBe(newReversal?.id);
    // The already-reversed original is not reversed a second time.
    expect(
      [...store.inventory.stockMovements.values()].filter(
        (movement) => movement.reversalOfId === alreadyReversed,
      ),
    ).toHaveLength(1);
    expect(store.salesLines.size).toBe(2);
    expect(store.salesLines.get(result.reversalSalesLineId)?.reversalOfId).toBe(line.id);
  });

  it("rejects a retry of an already-corrected line and reverses nothing further", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store);
    const input = {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    };

    await correctSalesLine(store, input);
    const movementsAfterFirst = store.inventory.stockMovements.size;

    await expect(correctSalesLine(store, input)).rejects.toThrow(/already reversed/);
    expect(store.salesLines.size).toBe(2);
    expect(store.inventory.stockMovements.size).toBe(movementsAfterFirst);
    for (const movementId of movementIds) {
      expect(
        [...store.inventory.stockMovements.values()].filter(
          (movement) => movement.reversalOfId === movementId,
        ),
      ).toHaveLength(1);
    }
  });

  it("rejects a blank reasonCode and writes nothing", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store);

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "   ",
      }),
    ).rejects.toThrow(/reasonCode is required/);
    expect(store.salesLines.size).toBe(1);
    expect(store.inventory.stockMovements.size).toBe(2);
  });

  it("rejects a reasonCode longer than 200 characters and writes nothing", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store);

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "x".repeat(201),
      }),
    ).rejects.toThrow(/at most 200/);
    expect(store.salesLines.size).toBe(1);
    expect(store.inventory.stockMovements.size).toBe(2);
  });

  it("hides a line that is missing or in another organization", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store);

    await expect(
      correctSalesLine(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/sales line not found in organization/);
    expect(store.salesLines.size).toBe(1);
    expect(store.inventory.stockMovements.size).toBe(2);
  });

  it("blocks a reversal covered by a reconciled reconciliation and posts nothing (DEC-117)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store);
    seedReconciliationCover(store, {
      organizationId: ORG,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      status: "within_tolerance",
    });

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/reconciled period/);

    assertNothingPosted(store, line, movementIds);
  });

  it.each(["pending", "exception"])(
    "allows a reversal when the covering reconciliation is %s (DEC-117)",
    async (status) => {
      const store = new FakeCorrectSalesLineStore();
      const { line } = await seedCorrectableLine(store);
      seedReconciliationCover(store, {
        organizationId: ORG,
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        status,
      });

      const result = await correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      });
      expect(store.salesLines.get(result.reversalSalesLineId)?.reversalOfId).toBe(line.id);
    },
  );

  it("allows a reversal when the reconciliation does not cover the day (DEC-117)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store);
    // One period ends the day before; another starts the day after.
    seedReconciliationCover(store, {
      organizationId: ORG,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      status: "approved",
    });
    seedReconciliationCover(store, {
      organizationId: ORG,
      periodStart: "2026-02-02",
      periodEnd: "2026-02-28",
      status: "approved",
    });

    const result = await correctSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });
    expect(store.salesLines.get(result.reversalSalesLineId)?.reversalOfId).toBe(line.id);
  });

  it("blocks a reversal when the transaction's day is location-locked (DEC-117)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store, { locationId: "loc-1" });
    seedLockedPeriodCloseCover(store, {
      organizationId: ORG,
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-02-01",
    });

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/locked for its location/);

    assertNothingPosted(store, line, movementIds);
  });

  it("blocks a reversal when the location close is created and locked through the real commands (DEC-119)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store, { locationId: "loc-1" });

    // The lock is produced by the real two-step close against the delegated
    // close fake, not hand-seeded: begin (creates `closing`) → lock.
    const opened = await beginPeriodClose(store.closeStore, {
      organizationId: ORG,
      actorId: ACTOR,
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: OCCURRED_AT.slice(0, 10),
      checklist: [],
    });
    expect(opened.status).toBe("closing");
    const locked = await lockPeriodClose(store.closeStore, {
      organizationId: ORG,
      actorId: ACTOR,
      periodCloseId: opened.id,
    });
    expect(locked).toMatchObject({ status: "locked", lockedBy: ACTOR });

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/locked for its location/);

    assertNothingPosted(store, line, movementIds);
  });

  it("blocks a reversal when the month is company-locked (DEC-117)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line, movementIds } = await seedCorrectableLine(store);
    seedLockedPeriodCloseCover(store, {
      organizationId: ORG,
      scopeType: "company",
      scopeId: ORG,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });

    await expect(
      correctSalesLine(store, {
        organizationId: ORG,
        actorId: ACTOR,
        salesLineId: line.id,
        reasonCode: "customer-refund",
      }),
    ).rejects.toThrow(/locked for the company/);

    assertNothingPosted(store, line, movementIds);
  });

  it("allows a reversal when the lock is on another scope or date (DEC-117)", async () => {
    const store = new FakeCorrectSalesLineStore();
    const { line } = await seedCorrectableLine(store, { locationId: "loc-1" });
    // A lock for another location, the same day.
    seedLockedPeriodCloseCover(store, {
      organizationId: ORG,
      scopeType: "location",
      scopeId: "other-loc",
      periodStart: "2026-02-01",
    });
    // A lock for the right location, a different day.
    seedLockedPeriodCloseCover(store, {
      organizationId: ORG,
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-02-02",
    });
    // A company lock in another organization.
    seedLockedPeriodCloseCover(store, {
      organizationId: OTHER_ORG,
      scopeType: "company",
      scopeId: OTHER_ORG,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });

    const result = await correctSalesLine(store, {
      organizationId: ORG,
      actorId: ACTOR,
      salesLineId: line.id,
      reasonCode: "customer-refund",
    });
    expect(store.salesLines.get(result.reversalSalesLineId)?.reversalOfId).toBe(line.id);
  });
});
