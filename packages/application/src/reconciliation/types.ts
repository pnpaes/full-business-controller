import type { ToleranceKind } from "@aquarela/domain";

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
 * `DEC-072` (accepted 2026-09-20) added the effective-dated FIN-owned
 * `reconciliation_tolerance` config table: the tolerance effective at the
 * period end is resolved from it (`findReconciliationTolerance`), and
 * `reconciliation.tolerance` remains the **per-row snapshot** of what was
 * applied.
 *
 * Recorded open points — deliberately **not** resolved (see
 * `packages/persistence/src/schema/sales.ts`):
 * (e) `settlement.source_file_id` is a plain uuid (`file_object` absent).
 *
 * Closed by `DEC-078` (migration `0028`), constrained at the persistence layer:
 * (i) `settlement.status` is checked against `SETTLEMENT_STATUS`
 *     (`settlement_status_check`, `{received, paid, void}`; default `received`);
 * (j) `reconciliation.scope_type` is checked against the distinct
 *     `RECONCILIATION_SCOPE_TYPE` (`reconciliation_scope_type_check`,
 *     `{import_run, sales_source, settlement, supplier_invoice}`), and the
 *     reconcile commands reject an unknown scope via
 *     `assertReconciliationScopeType` (`DEC-078` (b)).
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

/**
 * One effective-dated `reconciliation_tolerance` config row (`DEC-072`). The
 * window is half-open `[effectiveFrom, effectiveTo)`: a row is effective at
 * `asOf` when `effectiveFrom <= asOf` and `effectiveTo` is null or `> asOf`.
 * `rate` is a `numeric(9,6)` fraction, `floorAmount` a `numeric(19,4)` NOK floor.
 */
export interface ReconciliationToleranceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ToleranceKind;
  readonly rate: string;
  readonly floorAmount: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly effectiveFrom: string;
  /** `date` (`yyyy-mm-dd`), or null while the window is open. */
  readonly effectiveTo: string | null;
}

/** A new tolerance config row; the id and audit columns are store-assigned. */
export interface NewReconciliationToleranceRecord {
  readonly organizationId: string;
  readonly kind: ToleranceKind;
  readonly rate: string;
  readonly floorAmount: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly effectiveFrom: string;
  /** `date` (`yyyy-mm-dd`), or null for an open-ended window. */
  readonly effectiveTo?: string | null;
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
  /**
   * The effective-dated tolerance config for `(organizationId, kind)` at `asOf`
   * (`DEC-072`), or `undefined` when no row covers that date. The window is
   * half-open `[effectiveFrom, effectiveTo)`.
   */
  findReconciliationTolerance(query: {
    readonly organizationId: string;
    readonly kind: ToleranceKind;
    /** `date` (`yyyy-mm-dd`). */
    readonly asOf: string;
  }): Promise<ReconciliationToleranceRecord | undefined>;
  /** Tolerance config rows for one organization, newest effective first. */
  listReconciliationTolerances(query: {
    readonly organizationId: string;
    readonly kind?: ToleranceKind;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly ReconciliationToleranceRecord[]>;
  createReconciliationTolerance(
    input: NewReconciliationToleranceRecord,
  ): Promise<ReconciliationToleranceRecord>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
