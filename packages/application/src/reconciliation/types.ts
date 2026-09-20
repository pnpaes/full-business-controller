import type { AuditInput } from "../auth";
import type { ImportStore } from "../imports";

/**
 * Application-level ports and DTOs for row 12 — **reconciliation**
 * (`REC-001`, `REC-002`, `REC-005`; `DEC-026`, `DEC-035`, `DEC-040`).
 *
 * `ReconciliationStore` reuses the row-11 `ImportStore` reads
 * (`findImportRun`, `listImportStagingRows`) so `reconcileImportRun` can compare
 * the run's source total against its posted and approved-disposition rows, and
 * adds the settlement and reconciliation reads/writes.
 *
 * `timestamptz` columns are ISO strings; `date` columns are `yyyy-mm-dd`.
 *
 * Recorded open points — deliberately **not** resolved (see
 * `packages/persistence/src/schema/sales.ts`):
 * (b) there is **no tolerance-configuration table** (`DEC-026`'s effective-dated
 *     FIN-owned config), so the command takes an explicit tolerance or an
 *     explicit opt-in to the published `DEC-026` default and a missing tolerance
 *     is never applied silently;
 * (d) `reconciliation.tolerance` is a per-row snapshot, not effective-dated
 *     configuration;
 * (e) `settlement.source_file_id` is a plain uuid (`file_object` absent);
 * (i) there is no `settlement_status` vocabulary, so `settlement.status` is
 *     unconstrained text;
 * (j) `reconciliation.scope_type` values are unresolved; this slice writes the
 *     labels it owns (`import_run`, `settlement`).
 */

export interface SettlementRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly channelId: string | null;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** numeric(19,4). */
  readonly paidAmount: string | null;
  readonly feeAmount: string | null;
  readonly refundAmount: string | null;
  readonly currency: string;
  readonly status: string;
}

export interface ReconciliationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** numeric(19,4). */
  readonly expectedAmount: string;
  readonly actualAmount: string;
  readonly tolerance: string;
  readonly difference: string;
  readonly status: string;
  readonly resolutionNote: string | null;
  readonly ownerId: string | null;
  /** `date` (`yyyy-mm-dd`). */
  readonly dueDate: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO, or null before the first update. */
  readonly updatedAt: string | null;
}

export interface NewReconciliationRecord {
  readonly organizationId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly expectedAmount: string;
  readonly actualAmount: string;
  readonly tolerance: string;
  readonly difference: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
  readonly createdBy: string;
}

export interface ReconciliationPatch {
  readonly status?: string;
  readonly resolutionNote?: string | null;
  readonly ownerId?: string | null;
  readonly dueDate?: string | null;
  readonly updatedBy?: string;
}

export interface FindReconciliationQuery {
  readonly organizationId: string;
  readonly reconciliationId: string;
}

export interface FindReconciliationByScopeQuery {
  readonly organizationId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly periodStart: string;
}

export interface ListReconciliationsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface FindSettlementQuery {
  readonly organizationId: string;
  readonly settlementId: string;
}

/**
 * The posted sales total for a channel over a period, at money scale, used by
 * `reconcileSettlement` as the "sales" side of settlement-vs-sales. `channelId`
 * null sums every channel (the settlement carries no channel).
 */
export interface SumSalesForChannelPeriodQuery {
  readonly organizationId: string;
  readonly channelId: string | null;
  /** `date` (`yyyy-mm-dd`), inclusive. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
}

export interface ReconciliationStore extends Omit<ImportStore, "withTransaction"> {
  /** Binds `fn` to one transaction over the reconciliation/import surface. */
  withTransaction<T>(fn: (store: ReconciliationStore) => Promise<T>): Promise<T>;
  findSettlement(query: FindSettlementQuery): Promise<SettlementRecord | undefined>;
  listSettlements(query: {
    readonly organizationId: string;
    readonly provider?: string;
    readonly channelId?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly SettlementRecord[]>;
  sumSalesForChannelPeriod(query: SumSalesForChannelPeriodQuery): Promise<string>;
  findReconciliation(query: FindReconciliationQuery): Promise<ReconciliationRecord | undefined>;
  findReconciliationByScope(
    query: FindReconciliationByScopeQuery,
  ): Promise<ReconciliationRecord | undefined>;
  listReconciliations(query: ListReconciliationsQuery): Promise<readonly ReconciliationRecord[]>;
  createReconciliation(input: NewReconciliationRecord): Promise<ReconciliationRecord>;
  updateReconciliation(
    query: FindReconciliationQuery,
    patch: ReconciliationPatch,
  ): Promise<ReconciliationRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
