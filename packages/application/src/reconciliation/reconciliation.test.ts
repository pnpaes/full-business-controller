import { describe, expect, it } from "vitest";

import { DomainError } from "@aquarela/domain";
import type { ToleranceKind } from "@aquarela/domain";

import { listReconciliations } from "./list-reconciliations";
import { reconcileImportRun } from "./reconcile-import-run";
import { reconcileSettlement } from "./reconcile-settlement";
import { registerReconciliationTolerance } from "./register-reconciliation-tolerance";
import { resolveReconciliation } from "./resolve-reconciliation";
import { FakeReconciliationStore, salesTotalKey, seedReconciliationFixture } from "./test-support";
import type { ReconciliationRecord } from "./types";
import { resolveEffectiveTolerance, resolveTolerance } from "./validation";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "actor-1";

interface SeedRunRow {
  /** `null` omits the field entirely; `undefined` defaults to `NOK`. */
  readonly currency?: string | null;
  readonly grossAmount?: string | null;
  readonly linkedSalesLineId?: string | null;
  readonly mappingState?: string;
  readonly errorCode?: string | null;
  /** When set, an approved disposition is recorded for this row. */
  readonly disposition?: string;
}

async function seedRun(
  store: FakeReconciliationStore,
  options: {
    readonly organizationId?: string;
    readonly status?: string;
    readonly totals?: Readonly<Record<string, string>>;
    readonly rows: readonly SeedRunRow[];
  },
): Promise<{ importRunId: string; rowIds: string[] }> {
  const run = await store.createImportRun({
    organizationId: options.organizationId ?? ORG,
    source: "frontline",
    profileVersion: "v1",
    importProfileId: null,
    fileObjectId: null,
    fileHash: `hash-${store.imports.importRuns.size + 1}`,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    status: options.status ?? "posted",
    rowCounts: {},
    diagnostics: {},
    createdBy: ACTOR,
  });
  const rowIds: string[] = [];
  for (const [index, row] of options.rows.entries()) {
    const normalized: Record<string, unknown> = {};
    if (row.currency !== null) {
      normalized.currency = row.currency ?? "NOK";
    }
    if (row.grossAmount !== undefined && row.grossAmount !== null) {
      normalized.gross_amount = row.grossAmount;
    }
    const created = await store.createImportStagingRow({
      importRunId: run.id,
      sourceRowNo: index + 1,
      raw: {},
      normalized,
      mappingState: row.mappingState ?? "mapped",
      errorCode: row.errorCode ?? null,
      linkedSalesLineId: row.linkedSalesLineId ?? null,
    });
    rowIds.push(created.id);
  }
  const dispositions = options.rows
    .map((row, index) => ({ row, stagingRowId: rowIds[index]! }))
    .filter((entry) => entry.row.disposition !== undefined)
    .map((entry, index) => ({
      stagingRowId: entry.stagingRowId,
      sourceRowNo: index + 1,
      disposition: entry.row.disposition,
      reason: "test disposition",
      actorId: ACTOR,
      at: "2026-02-01T00:00:00.000Z",
    }));
  const diagnostics: Record<string, unknown> = {};
  if (options.totals !== undefined) {
    diagnostics.totals = options.totals;
  }
  if (dispositions.length > 0) {
    diagnostics.dispositions = dispositions;
  }
  await store.updateImportRun(run.id, { diagnostics });
  return { importRunId: run.id, rowIds };
}

describe("reconcileImportRun", () => {
  it("reconciles a fully posted run within the DEC-026 default tolerance", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    const result = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      useDecisionDefaultTolerance: true,
    });

    expect(result).toMatchObject({
      status: "within_tolerance",
      expected: "100.0000",
      actual: "100.0000",
      tolerance: "5.0000",
      difference: "0.0000",
      residual: "0.0000",
      created: true,
    });
    expect(store.reconciliations.size).toBe(1);
    expect(store.auditEvents.map((event) => event.action)).toContain("sales.import_run.reconciled");
  });

  it("counts posted plus approved dispositions as the actual (DEC-035)", async () => {
    const store = new FakeReconciliationStore();
    // No diagnostics totals, so the source total falls back to the row sum.
    const { importRunId } = await seedRun(store, {
      rows: [
        { grossAmount: "60.0000", linkedSalesLineId: "sales-line-1" },
        { grossAmount: "40.0000", disposition: "unmapped" },
      ],
    });

    const result = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      useDecisionDefaultTolerance: true,
    });

    expect(result).toMatchObject({
      status: "within_tolerance",
      expected: "100.0000",
      actual: "100.0000",
      difference: "0.0000",
    });
  });

  it("flags an exception when the residual exceeds the tolerance", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [
        { grossAmount: "80.0000", linkedSalesLineId: "sales-line-1" },
        { grossAmount: "5.0000", disposition: "rejected" },
      ],
    });

    const result = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      tolerance: "5.0000",
    });

    expect(result).toMatchObject({
      status: "exception",
      expected: "100.0000",
      actual: "85.0000",
      tolerance: "5.0000",
      difference: "-15.0000",
      residual: "-15.0000",
    });
  });

  it("does not default a missing tolerance silently and blocks close", async () => {
    const store = new FakeReconciliationStore();
    // No effective DEC-072 config for this organization: the close must block.
    store.tolerances.clear();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    await expect(
      reconcileImportRun(store, { organizationId: ORG, actorId: ACTOR, importRunId }),
    ).rejects.toThrow(/tolerance is required/);
    expect(store.reconciliations.size).toBe(0);

    const withExplicitTolerance = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      tolerance: "0.0000",
    });
    expect(withExplicitTolerance.status).toBe("within_tolerance");
  });

  it("refuses a run that has not posted", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      status: "validated",
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    await expect(
      reconcileImportRun(store, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId,
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/not posted and cannot be reconciled/);
    expect(store.reconciliations.size).toBe(0);
  });

  it("blocks close while a non-posted row lacks an approved disposition (DEC-035)", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [
        { grossAmount: "60.0000", linkedSalesLineId: "sales-line-1" },
        { grossAmount: "40.0000" },
      ],
    });

    await expect(
      reconcileImportRun(store, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId,
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/no approved disposition/);
    expect(store.reconciliations.size).toBe(0);
  });

  it("rejects a multi-currency run and a run with no currency", async () => {
    const multiCurrency = new FakeReconciliationStore();
    const multi = await seedRun(multiCurrency, {
      totals: { NOK: "100.0000", USD: "50.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });
    await expect(
      reconcileImportRun(multiCurrency, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId: multi.importRunId,
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/multi-currency/);

    const noCurrency = new FakeReconciliationStore();
    const bare = await seedRun(noCurrency, {
      rows: [{ currency: null, grossAmount: "10.0000", linkedSalesLineId: "sales-line-1" }],
    });
    await expect(
      reconcileImportRun(noCurrency, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId: bare.importRunId,
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/no currency/);
  });

  it("updates the existing reconciliation for the same scope instead of duplicating it", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    const first = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      useDecisionDefaultTolerance: true,
    });
    const second = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      useDecisionDefaultTolerance: true,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reconciliationId).toBe(first.reconciliationId);
    expect(store.reconciliations.size).toBe(1);
  });

  it("is organization-scoped", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    await expect(
      reconcileImportRun(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        importRunId,
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/import run not found/);
  });

  it("accepts a valid explicit scopeType and rejects an unknown one (DEC-078)", async () => {
    const store = new FakeReconciliationStore();
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    const result = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      scopeType: "sales_source",
      useDecisionDefaultTolerance: true,
    });
    expect(store.reconciliations.get(result.reconciliationId)?.scopeType).toBe("sales_source");

    const rejected = new FakeReconciliationStore();
    const run = await seedRun(rejected, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });
    await expect(
      reconcileImportRun(rejected, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId: run.importRunId,
        scopeType: "not_a_scope",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      reconcileImportRun(rejected, {
        organizationId: ORG,
        actorId: ACTOR,
        importRunId: run.importRunId,
        scopeType: "not_a_scope",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/unknown reconciliation scope_type/);
    expect(rejected.reconciliations.size).toBe(0);
  });
});

describe("reconcileSettlement", () => {
  function storeWithSalesTotal(actual: string): {
    store: FakeReconciliationStore;
    settlementId: string;
  } {
    const store = new FakeReconciliationStore();
    const fixture = seedReconciliationFixture(store);
    store.salesTotals.set(
      salesTotalKey({
        channelId: fixture.channelId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currency: "NOK",
      }),
      actual,
    );
    return { store, settlementId: fixture.settlementId };
  }

  it("reconciles the settlement's paid amount against sales at the tolerance boundary", async () => {
    const { store, settlementId } = storeWithSalesTotal("10050.0000");

    const result = await reconcileSettlement(store, {
      organizationId: ORG,
      actorId: ACTOR,
      settlementId,
      useDecisionDefaultTolerance: true,
    });

    expect(result).toMatchObject({
      status: "within_tolerance",
      expected: "10000.0000",
      actual: "10050.0000",
      tolerance: "50.0000",
      difference: "50.0000",
      created: true,
    });
    expect(store.auditEvents.map((event) => event.action)).toContain("sales.settlement.reconciled");
  });

  it("flags an exception when the settlement difference exceeds the tolerance", async () => {
    const { store, settlementId } = storeWithSalesTotal("9000.0000");

    const result = await reconcileSettlement(store, {
      organizationId: ORG,
      actorId: ACTOR,
      settlementId,
      useDecisionDefaultTolerance: true,
    });

    expect(result).toMatchObject({
      status: "exception",
      expected: "10000.0000",
      actual: "9000.0000",
      difference: "-1000.0000",
    });
  });

  it("does not default a missing tolerance and accepts an explicit one", async () => {
    const { store, settlementId } = storeWithSalesTotal("9000.0000");
    // No effective DEC-072 config for this organization: the close must block.
    store.tolerances.clear();

    await expect(
      reconcileSettlement(store, { organizationId: ORG, actorId: ACTOR, settlementId }),
    ).rejects.toThrow(/tolerance is required/);

    const resolved = await reconcileSettlement(store, {
      organizationId: ORG,
      actorId: ACTOR,
      settlementId,
      tolerance: "2000.0000",
    });
    expect(resolved).toMatchObject({ status: "within_tolerance", tolerance: "2000.0000" });
  });

  it("rejects a foreign settlement and a settlement without a paid amount", async () => {
    const { store, settlementId } = storeWithSalesTotal("10000.0000");
    await expect(
      reconcileSettlement(store, {
        organizationId: ORG,
        actorId: ACTOR,
        settlementId: "settlement-nope",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/settlement not found/);

    store.settlements.set("settlement-null", {
      id: "settlement-null",
      organizationId: OTHER_ORG,
      provider: "wolt",
      channelId: "channel-wolt",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      paidAmount: null,
      feeAmount: null,
      refundAmount: null,
      currency: "NOK",
      status: "paid",
    });
    await expect(
      reconcileSettlement(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        settlementId: "settlement-null",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/no paid amount/);
    expect(settlementId).toBeDefined();
  });

  it("updates rather than duplicates on a re-run", async () => {
    const { store, settlementId } = storeWithSalesTotal("10050.0000");
    const input = {
      organizationId: ORG,
      actorId: ACTOR,
      settlementId,
      useDecisionDefaultTolerance: true,
    } as const;

    const first = await reconcileSettlement(store, input);
    const second = await reconcileSettlement(store, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reconciliationId).toBe(first.reconciliationId);
    expect(store.reconciliations.size).toBe(1);
  });

  it("accepts a valid explicit scopeType and rejects an unknown one (DEC-078)", async () => {
    const { store, settlementId } = storeWithSalesTotal("10000.0000");

    const result = await reconcileSettlement(store, {
      organizationId: ORG,
      actorId: ACTOR,
      settlementId,
      scopeType: "sales_source",
      useDecisionDefaultTolerance: true,
    });
    expect(store.reconciliations.get(result.reconciliationId)?.scopeType).toBe("sales_source");

    const rejected = storeWithSalesTotal("10000.0000");
    await expect(
      reconcileSettlement(rejected.store, {
        organizationId: ORG,
        actorId: ACTOR,
        settlementId: rejected.settlementId,
        scopeType: "not_a_scope",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      reconcileSettlement(rejected.store, {
        organizationId: ORG,
        actorId: ACTOR,
        settlementId: rejected.settlementId,
        scopeType: "not_a_scope",
        useDecisionDefaultTolerance: true,
      }),
    ).rejects.toThrow(/unknown reconciliation scope_type/);
    expect(rejected.store.reconciliations.size).toBe(0);
  });
});

async function seedReconciliation(
  store: FakeReconciliationStore,
  overrides: {
    readonly organizationId?: string;
    readonly scopeType?: string;
    readonly scopeId?: string;
    readonly periodStart?: string;
    readonly status?: string;
  } = {},
): Promise<ReconciliationRecord> {
  return store.createReconciliation({
    organizationId: overrides.organizationId ?? ORG,
    scopeType: overrides.scopeType ?? "import_run",
    scopeId: overrides.scopeId ?? "import-run-1",
    periodStart: overrides.periodStart ?? "2026-01-01",
    periodEnd: "2026-01-31",
    expectedAmount: "100.0000",
    actualAmount: "85.0000",
    tolerance: "5.0000",
    difference: "-15.0000",
    status: overrides.status ?? "exception",
    ownerId: null,
    dueDate: null,
    createdBy: ACTOR,
  });
}

describe("resolveReconciliation", () => {
  it("moves the status and records the resolution trail", async () => {
    const store = new FakeReconciliationStore();
    const reconciliation = await seedReconciliation(store);

    const resolved = await resolveReconciliation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      reconciliationId: reconciliation.id,
      status: "resolved",
      resolutionNote: "Provider credited the difference",
      ownerId: "actor-2",
    });

    expect(resolved).toMatchObject({
      status: "resolved",
      resolutionNote: "Provider credited the difference",
      ownerId: "actor-2",
    });
    expect(resolved.updatedAt).not.toBeNull();
    const audit = store.auditEvents.at(-1)!;
    expect(audit).toMatchObject({
      action: "sales.reconciliation.resolved",
      entityId: reconciliation.id,
      before: { status: "exception" },
      after: { status: "resolved", resolution_note: "Provider credited the difference" },
    });
  });

  it("requires a known status and a note to close a reconciliation", async () => {
    const store = new FakeReconciliationStore();
    const reconciliation = await seedReconciliation(store);

    await expect(
      resolveReconciliation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        reconciliationId: reconciliation.id,
        status: "nonsense",
      }),
    ).rejects.toThrow(/unknown reconciliation status/);
    await expect(
      resolveReconciliation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        reconciliationId: reconciliation.id,
        status: "resolved",
      }),
    ).rejects.toThrow(/resolution note is required/);
    await expect(
      resolveReconciliation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        reconciliationId: reconciliation.id,
        status: "approved",
        resolutionNote: "   ",
      }),
    ).rejects.toThrow(/resolution note is required/);

    const pending = await resolveReconciliation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      reconciliationId: reconciliation.id,
      status: "pending",
    });
    expect(pending.status).toBe("pending");
  });

  it("is organization-scoped and reports a missing reconciliation", async () => {
    const store = new FakeReconciliationStore();
    const reconciliation = await seedReconciliation(store);

    await expect(
      resolveReconciliation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        reconciliationId: "reconciliation-nope",
        status: "resolved",
        resolutionNote: "note",
      }),
    ).rejects.toThrow(/not found in organization/);
    await expect(
      resolveReconciliation(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        reconciliationId: reconciliation.id,
        status: "resolved",
        resolutionNote: "note",
      }),
    ).rejects.toThrow(/not found in organization/);
  });
});

describe("listReconciliations", () => {
  it("pages newest first with filters and organization scoping", async () => {
    const store = new FakeReconciliationStore();
    await seedReconciliation(store, { periodStart: "2026-01-01" });
    await seedReconciliation(store, { periodStart: "2026-01-02", status: "within_tolerance" });
    await seedReconciliation(store, { periodStart: "2026-01-03", scopeType: "settlement" });
    await seedReconciliation(store, { organizationId: OTHER_ORG, periodStart: "2026-01-04" });

    const page = await listReconciliations(store, { organizationId: ORG, limit: 2 });
    expect(page.hasMore).toBe(true);
    expect(page.reconciliations.map((row) => row.periodStart)).toEqual([
      "2026-01-03",
      "2026-01-02",
    ]);

    const rest = await listReconciliations(store, { organizationId: ORG, limit: 2, offset: 2 });
    expect(rest.hasMore).toBe(false);
    expect(rest.reconciliations.map((row) => row.periodStart)).toEqual(["2026-01-01"]);

    const byStatus = await listReconciliations(store, {
      organizationId: ORG,
      status: "within_tolerance",
    });
    expect(byStatus.reconciliations.map((row) => row.periodStart)).toEqual(["2026-01-02"]);

    const byScope = await listReconciliations(store, {
      organizationId: ORG,
      scopeType: "settlement",
    });
    expect(byScope.reconciliations.map((row) => row.periodStart)).toEqual(["2026-01-03"]);

    expect(
      (await listReconciliations(store, { organizationId: OTHER_ORG })).reconciliations,
    ).toHaveLength(1);
  });

  it("validates limit and offset bounds", async () => {
    const store = new FakeReconciliationStore();
    await expect(listReconciliations(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(listReconciliations(store, { organizationId: ORG, limit: 201 })).rejects.toThrow(
      DomainError,
    );
    await expect(listReconciliations(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});

describe("resolveTolerance (DEC-026)", () => {
  it("applies the published sales/settlement default: max(0.5%, 5 NOK)", () => {
    expect(
      resolveTolerance({
        kind: "sales_settlement",
        expected: "100.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("5.0000");
    expect(
      resolveTolerance({
        kind: "sales_settlement",
        expected: "1000.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("5.0000");
    expect(
      resolveTolerance({
        kind: "sales_settlement",
        expected: "10000.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("50.0000");
    // The rate is computed on the absolute expected amount.
    expect(
      resolveTolerance({
        kind: "sales_settlement",
        expected: "-10000.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("50.0000");
  });

  it("applies the published supplier default: max(1%, 10 NOK)", () => {
    expect(
      resolveTolerance({
        kind: "supplier_invoice",
        expected: "500.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("10.0000");
    expect(
      resolveTolerance({
        kind: "supplier_invoice",
        expected: "1000.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("10.0000");
    expect(
      resolveTolerance({
        kind: "supplier_invoice",
        expected: "2000.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("20.0000");
  });

  it("prefers an explicit tolerance and normalizes it to money scale", () => {
    expect(
      resolveTolerance({
        kind: "sales_settlement",
        expected: "1000000.0000",
        tolerance: "1",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("1.0000");
  });

  it("rejects a negative tolerance and a missing one", () => {
    expect(() =>
      resolveTolerance({ kind: "sales_settlement", expected: "100.0000", tolerance: "-1.0000" }),
    ).toThrow(/must not be negative/);
    expect(() => resolveTolerance({ kind: "sales_settlement", expected: "100.0000" })).toThrow(
      /tolerance is required/,
    );
    expect(() =>
      resolveTolerance({
        kind: "sales_settlement",
        expected: "100.0000",
        useDecisionDefaultTolerance: false,
      }),
    ).toThrow(/tolerance is required/);
  });

  it("rejects an unknown tolerance kind", () => {
    expect(() =>
      resolveTolerance({
        kind: "not_a_kind" as unknown as ToleranceKind,
        expected: "100.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toThrow(/unknown tolerance kind/);
  });
});

describe("resolveEffectiveTolerance (DEC-072)", () => {
  it("selects the config row effective at asOf on a half-open window", async () => {
    const store = new FakeReconciliationStore();
    store.tolerances.clear();
    store.addTolerance({
      organizationId: ORG,
      kind: "sales_settlement",
      rate: "0.02",
      floorAmount: "0",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-02-01",
    });
    store.addTolerance({
      organizationId: ORG,
      kind: "sales_settlement",
      rate: "0.01",
      floorAmount: "0",
      effectiveFrom: "2026-02-01",
      effectiveTo: null,
    });

    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-01-31",
        expected: "100.0000",
      }),
    ).toBe("2.0000");
    // The `to` boundary is exclusive: the first row's `effective_to = 2026-02-01`
    // is NOT effective at that date, which belongs to the later window, so
    // 2026-02-01 selects the later row.
    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-02-01",
        expected: "100.0000",
      }),
    ).toBe("1.0000");
  });

  it("prefers the effective config over the published default, but an explicit tolerance wins", async () => {
    const store = new FakeReconciliationStore();
    store.tolerances.clear();
    // The published DEC-026 default for sales_settlement would be 5.0000 here.
    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-01-31",
        expected: "100.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("5.0000");

    store.addTolerance({
      organizationId: ORG,
      kind: "sales_settlement",
      rate: "0.02",
      floorAmount: "0",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-01-31",
        expected: "100.0000",
        useDecisionDefaultTolerance: true,
      }),
    ).toBe("2.0000");
    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-01-31",
        expected: "100.0000",
        tolerance: "7.5",
      }),
    ).toBe("7.5000");
  });

  it("blocks close with no config and no override/opt-in", async () => {
    const store = new FakeReconciliationStore();
    store.tolerances.clear();
    await expect(
      resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-01-31",
        expected: "100.0000",
      }),
    ).rejects.toThrow(/tolerance is required/);
  });

  it("makes the command prefer the effective config over the published default", async () => {
    const store = new FakeReconciliationStore();
    store.tolerances.clear();
    store.addTolerance({
      organizationId: ORG,
      kind: "sales_settlement",
      rate: "0.02",
      floorAmount: "0",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    const { importRunId } = await seedRun(store, {
      totals: { NOK: "100.0000" },
      rows: [{ grossAmount: "100.0000", linkedSalesLineId: "sales-line-1" }],
    });

    const result = await reconcileImportRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      importRunId,
      useDecisionDefaultTolerance: true,
    });

    // 0.02 × 100 vs the published 5.0000 floor: the config wins.
    expect(result.tolerance).toBe("2.0000");
  });
});

describe("registerReconciliationTolerance (DEC-072)", () => {
  async function freshStore(): Promise<FakeReconciliationStore> {
    const store = new FakeReconciliationStore();
    store.tolerances.clear();
    return store;
  }

  it("registers a window, writes an audit fact and resolves it", async () => {
    const store = await freshStore();

    const result = await registerReconciliationTolerance(store, {
      organizationId: ORG,
      actorId: ACTOR,
      kind: "sales_settlement",
      rate: "0.005",
      floorAmount: "5",
      effectiveFrom: "2026-01-01",
    });

    expect(result).toMatchObject({
      kind: "sales_settlement",
      rate: "0.005000",
      floorAmount: "5.0000",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    expect(store.auditEvents.map((event) => event.action)).toContain(
      "sales.reconciliation_tolerance.registered",
    );
    expect(
      await resolveEffectiveTolerance(store, {
        organizationId: ORG,
        kind: "sales_settlement",
        asOf: "2026-03-01",
        expected: "100.0000",
      }),
    ).toBe("5.0000");
  });

  it("rejects an overlapping window for the same organization and kind", async () => {
    const store = await freshStore();
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      rate: "0.005",
      floorAmount: "5",
    } as const;

    await registerReconciliationTolerance(store, {
      ...base,
      kind: "sales_settlement",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-07-01",
    });

    await expect(
      registerReconciliationTolerance(store, {
        ...base,
        kind: "sales_settlement",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-12-31",
      }),
    ).rejects.toThrow(/overlaps an existing sales_settlement window/);

    // Adjacent windows do not overlap; another kind is a separate key.
    await expect(
      registerReconciliationTolerance(store, {
        ...base,
        kind: "sales_settlement",
        effectiveFrom: "2026-07-01",
      }),
    ).resolves.toBeDefined();
    await expect(
      registerReconciliationTolerance(store, {
        ...base,
        kind: "supplier_invoice",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-12-31",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a negative rate, a negative floor, an unknown kind and an empty window", async () => {
    const store = await freshStore();
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      kind: "sales_settlement",
      effectiveFrom: "2026-01-01",
    } as const;

    await expect(
      registerReconciliationTolerance(store, { ...base, rate: "-0.01", floorAmount: "5" }),
    ).rejects.toThrow(/rate must not be negative/);
    await expect(
      registerReconciliationTolerance(store, { ...base, rate: "0.005", floorAmount: "-1" }),
    ).rejects.toThrow(/floorAmount must not be negative/);
    await expect(
      registerReconciliationTolerance(store, {
        ...base,
        kind: "bogus" as ToleranceKind,
        rate: "0.005",
        floorAmount: "5",
      }),
    ).rejects.toThrow(/unknown tolerance kind/);
    await expect(
      registerReconciliationTolerance(store, {
        ...base,
        rate: "0.005",
        floorAmount: "5",
        effectiveTo: "2026-01-01",
      }),
    ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
  });
});
