import { describe, expect, it } from "vitest";

import { DomainError } from "@aquarela/domain";

import { getSalesTransaction } from "./get-sales-transaction";
import { DEFAULT_SALES_LIMIT, listSalesTransactions } from "./list-sales-transactions";
import { postImportRun } from "./post-import-run";
import { postTheoreticalConsumption } from "./post-theoretical-consumption";
import {
  FakeConsumptionStore,
  FakeSalesStore,
  seedConsumptionFixture,
  seedImportRun,
  seedSalesLine,
  stagingRow,
} from "./test-support";
import type { ConsumptionFixture } from "./test-support";
import type { NewSalesLineRecord, NewSalesTransactionRecord } from "./types";

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
            mappingState: "error",
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
