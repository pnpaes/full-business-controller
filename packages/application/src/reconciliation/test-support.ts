import type { ToleranceKind } from "@aquarela/domain";

import type { AuditInput } from "../auth";
import { FakeImportStore } from "../imports/test-support";

import type {
  FindReconciliationQuery,
  NewReconciliationRecord,
  NewReconciliationToleranceRecord,
  ReconciliationPatch,
  ReconciliationRecord,
  ReconciliationStore,
  ReconciliationToleranceRecord,
  SettlementRecord,
} from "./types";

/** Key for the fake settlement-vs-sales total map. */
export function salesTotalKey(input: {
  readonly channelId: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
}): string {
  return [input.channelId ?? "*", input.periodStart, input.periodEnd, input.currency].join(
    "\u0000",
  );
}

/**
 * In-memory `ReconciliationStore` for the unit suite. The row-11 import reads
 * are delegated to a `FakeImportStore`, so a run and its staging rows are seeded
 * exactly as in the import tests; settlement-vs-sales totals are supplied
 * through `salesTotals`. `reconciliation.postgres.test.ts` covers the real
 * adapter under `DATABASE_URL`.
 */
export class FakeReconciliationStore implements ReconciliationStore {
  readonly imports = new FakeImportStore();
  readonly settlements = new Map<string, SettlementRecord>();
  readonly reconciliations = new Map<string, ReconciliationRecord>();
  /** `DEC-072` tolerance config rows, keyed by id. */
  readonly tolerances = new Map<string, ReconciliationToleranceRecord>();
  /** Settlement-vs-sales totals, keyed by `salesTotalKey`. */
  readonly salesTotals = new Map<string, string>();
  readonly auditEvents: AuditInput[] = [];
  private sequence = 0;

  constructor() {
    // The `DEC-026` published values seeded as the `org-1` config (`DEC-072`:
    // the published values are the seed config, not a hidden fallback) so the
    // effective config and the opt-in default yield identical numbers. Tests
    // that need a config-free organization clear `tolerances`.
    this.addTolerance({
      organizationId: "org-1",
      kind: "sales_settlement",
      rate: "0.005",
      floorAmount: "5",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    this.addTolerance({
      organizationId: "org-1",
      kind: "supplier_invoice",
      rate: "0.01",
      floorAmount: "10",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  /** Seeds one tolerance config row into the in-memory map. */
  addTolerance(input: NewReconciliationToleranceRecord): ReconciliationToleranceRecord {
    const record: ReconciliationToleranceRecord = {
      id: this.nextId("tolerance"),
      organizationId: input.organizationId,
      kind: input.kind,
      rate: input.rate,
      floorAmount: input.floorAmount,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    };
    this.tolerances.set(record.id, record);
    return record;
  }

  async withTransaction<T>(fn: (store: ReconciliationStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findImportRun(query: Parameters<FakeImportStore["findImportRun"]>[0]) {
    return this.imports.findImportRun(query);
  }

  listImportRuns(query: Parameters<FakeImportStore["listImportRuns"]>[0]) {
    return this.imports.listImportRuns(query);
  }

  createImportRun(input: Parameters<FakeImportStore["createImportRun"]>[0]) {
    return this.imports.createImportRun(input);
  }

  updateImportRun(id: string, values: Parameters<FakeImportStore["updateImportRun"]>[1]) {
    return this.imports.updateImportRun(id, values);
  }

  findImportStagingRow(query: Parameters<FakeImportStore["findImportStagingRow"]>[0]) {
    return this.imports.findImportStagingRow(query);
  }

  listImportStagingRows(query: Parameters<FakeImportStore["listImportStagingRows"]>[0]) {
    return this.imports.listImportStagingRows(query);
  }

  createImportStagingRow(input: Parameters<FakeImportStore["createImportStagingRow"]>[0]) {
    return this.imports.createImportStagingRow(input);
  }

  updateImportStagingRow(
    id: string,
    values: Parameters<FakeImportStore["updateImportStagingRow"]>[1],
  ) {
    return this.imports.updateImportStagingRow(id, values);
  }

  listExternalMappings(query: Parameters<FakeImportStore["listExternalMappings"]>[0]) {
    return this.imports.listExternalMappings(query);
  }

  findEntityBySku(query: Parameters<FakeImportStore["findEntityBySku"]>[0]) {
    return this.imports.findEntityBySku(query);
  }

  async findSettlement(query: {
    readonly organizationId: string;
    readonly settlementId: string;
  }): Promise<SettlementRecord | undefined> {
    const row = this.settlements.get(query.settlementId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async listSettlements(query: {
    readonly organizationId: string;
    readonly provider?: string;
    readonly channelId?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly SettlementRecord[]> {
    let rows = [...this.settlements.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.provider === undefined || row.provider === query.provider)
      .filter((row) => query.channelId === undefined || row.channelId === query.channelId)
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
    const offset = query.offset ?? 0;
    rows = rows.slice(offset);
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return rows;
  }

  async sumSalesForChannelPeriod(query: {
    readonly organizationId: string;
    readonly channelId: string | null;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly currency: string;
  }): Promise<string> {
    return this.salesTotals.get(salesTotalKey(query)) ?? "0.0000";
  }

  async findReconciliation(
    query: FindReconciliationQuery,
  ): Promise<ReconciliationRecord | undefined> {
    const row = this.reconciliations.get(query.reconciliationId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async findReconciliationByScope(query: {
    readonly organizationId: string;
    readonly scopeType: string;
    readonly scopeId: string;
    readonly periodStart: string;
  }): Promise<ReconciliationRecord | undefined> {
    return [...this.reconciliations.values()].find(
      (row) =>
        row.organizationId === query.organizationId &&
        row.scopeType === query.scopeType &&
        row.scopeId === query.scopeId &&
        row.periodStart === query.periodStart,
    );
  }

  async listReconciliations(query: {
    readonly organizationId: string;
    readonly status?: string;
    readonly scopeType?: string;
    readonly scopeId?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly ReconciliationRecord[]> {
    let rows = [...this.reconciliations.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.status === undefined || row.status === query.status)
      .filter((row) => query.scopeType === undefined || row.scopeType === query.scopeType)
      .filter((row) => query.scopeId === undefined || row.scopeId === query.scopeId)
      .sort((a, b) => {
        if (a.periodStart !== b.periodStart) {
          return a.periodStart < b.periodStart ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    rows = rows.slice(offset);
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return rows;
  }

  async createReconciliation(input: NewReconciliationRecord): Promise<ReconciliationRecord> {
    const record: ReconciliationRecord = {
      id: this.nextId("reconciliation"),
      ...input,
      resolutionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.reconciliations.set(record.id, record);
    return record;
  }

  async updateReconciliation(
    query: FindReconciliationQuery,
    patch: ReconciliationPatch,
  ): Promise<ReconciliationRecord | undefined> {
    const existing = this.reconciliations.get(query.reconciliationId);
    if (existing === undefined || existing.organizationId !== query.organizationId) {
      return undefined;
    }
    const record: ReconciliationRecord = {
      ...existing,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.resolutionNote === undefined ? {} : { resolutionNote: patch.resolutionNote }),
      ...(patch.ownerId === undefined ? {} : { ownerId: patch.ownerId }),
      ...(patch.dueDate === undefined ? {} : { dueDate: patch.dueDate }),
      updatedAt: new Date().toISOString(),
    };
    this.reconciliations.set(record.id, record);
    return record;
  }

  async findReconciliationTolerance(query: {
    readonly organizationId: string;
    readonly kind: ToleranceKind;
    readonly asOf: string;
  }): Promise<ReconciliationToleranceRecord | undefined> {
    const matches = [...this.tolerances.values()]
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          row.kind === query.kind &&
          row.effectiveFrom <= query.asOf &&
          (row.effectiveTo === null || row.effectiveTo > query.asOf),
      )
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    return matches[0];
  }

  async listReconciliationTolerances(query: {
    readonly organizationId: string;
    readonly kind?: ToleranceKind;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly ReconciliationToleranceRecord[]> {
    let rows = [...this.tolerances.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.kind === undefined || row.kind === query.kind)
      .sort((a, b) => {
        if (a.effectiveFrom !== b.effectiveFrom) {
          return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    rows = rows.slice(offset);
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return rows;
  }

  async createReconciliationTolerance(
    input: NewReconciliationToleranceRecord,
  ): Promise<ReconciliationToleranceRecord> {
    return this.addTolerance(input);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.auditEvents.push(input);
  }
}

export interface ReconciliationFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly settlementId: string;
  readonly channelId: string;
  readonly provider: string;
}

/** Seeds one settlement for the settlement-vs-sales tests. */
export function seedReconciliationFixture(store: FakeReconciliationStore): ReconciliationFixture {
  const fixture: ReconciliationFixture = {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    settlementId: "settlement-1",
    channelId: "channel-wolt",
    provider: "wolt",
  };
  store.settlements.set(fixture.settlementId, {
    id: fixture.settlementId,
    organizationId: fixture.organizationId,
    provider: fixture.provider,
    channelId: fixture.channelId,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    paidAmount: "10000.0000",
    feeAmount: "150.0000",
    refundAmount: "0.0000",
    currency: "NOK",
    status: "paid",
  });
  return fixture;
}
