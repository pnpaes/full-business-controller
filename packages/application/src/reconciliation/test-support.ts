import type { AuditInput } from "../auth";
import { FakeImportStore } from "../imports/test-support";

import type {
  FindReconciliationQuery,
  NewReconciliationRecord,
  ReconciliationPatch,
  ReconciliationRecord,
  ReconciliationStore,
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
  /** Settlement-vs-sales totals, keyed by `salesTotalKey`. */
  readonly salesTotals = new Map<string, string>();
  readonly auditEvents: AuditInput[] = [];
  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
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
