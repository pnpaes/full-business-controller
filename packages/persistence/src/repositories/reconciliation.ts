import { and, desc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client";
import { reconciliation, reconciliationTolerance } from "../schema";

export type Reconciliation = typeof reconciliation.$inferSelect;
export type NewReconciliation = typeof reconciliation.$inferInsert;
export type ReconciliationTolerance = typeof reconciliationTolerance.$inferSelect;
export type NewReconciliationTolerance = typeof reconciliationTolerance.$inferInsert;

/*
 * Slice-12 reconciliation reads/writes (`REC-001`, `REC-005`; `DEC-026`,
 * `DEC-035`) plus the `DEC-072` effective-dated tolerance config.
 *
 * `reconciliation` carries `organization_id` directly, so every read and write
 * is organization-scoped (`DEC-061`). `tolerance` is a per-row snapshot of what
 * was applied; the effective-dated FIN-owned config now lives in
 * `reconciliation_tolerance` (`DEC-072`, migration `0024`), read here by
 * `findReconciliationTolerance`. Resolving the effective config and blocking
 * close on a missing tolerance are application concerns, not enforced in this
 * module. `scope_type` is checked against `RECONCILIATION_SCOPE_TYPE`
 * (`DEC-078` (b), migration `0028`) and `scope_id` is a polymorphic plain uuid.
 * Only the status/resolution trail is mutable; the
 * amounts and period are creation-time facts.
 */

export async function createReconciliation(
  db: Database,
  input: NewReconciliation,
): Promise<Reconciliation> {
  const rows = await db.insert(reconciliation).values(input).returning();
  return rows[0]!;
}

export interface FindReconciliationQuery {
  readonly organizationId: string;
  readonly reconciliationId: string;
}

/** One reconciliation by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findReconciliation(
  db: Database,
  query: FindReconciliationQuery,
): Promise<Reconciliation | undefined> {
  const rows = await db
    .select()
    .from(reconciliation)
    .where(
      and(
        eq(reconciliation.id, query.reconciliationId),
        eq(reconciliation.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListReconciliationsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Reconciliations for one organization, newest period first (`period_start`,
 * then `id`), with optional status/scope filters. Every filter is optional
 * except the organization, so the caller never sees another tenant's rows.
 * Paging is applied after the ordering.
 */
export async function listReconciliations(
  db: Database,
  query: ListReconciliationsQuery,
): Promise<Reconciliation[]> {
  const statement = db
    .select()
    .from(reconciliation)
    .where(
      and(
        eq(reconciliation.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(reconciliation.status, query.status),
        query.scopeType === undefined ? undefined : eq(reconciliation.scopeType, query.scopeType),
        query.scopeId === undefined ? undefined : eq(reconciliation.scopeId, query.scopeId),
      ),
    )
    .orderBy(desc(reconciliation.periodStart), desc(reconciliation.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface FindReconciliationsCoveringDateQuery {
  readonly organizationId: string;
  /** `date`, `yyyy-mm-dd`; matched inclusively against `[period_start, period_end]`. */
  readonly at: string;
  /** Optional `scope_type` filter; omitted (or empty) matches every scope. */
  readonly scopeTypes?: readonly string[];
}

/**
 * The organization's reconciliations whose `[period_start, period_end]` contains
 * `at` (both bounds inclusive), newest period first, with an optional
 * `scope_type` filter (`DEC-117`). Organization-scoped (`DEC-061`); the reversal
 * gate is organization-wide by period, so there is no location/channel join. The
 * full rows are returned and the caller decides which statuses block.
 */
export async function findReconciliationsCoveringDate(
  db: Database,
  query: FindReconciliationsCoveringDateQuery,
): Promise<Reconciliation[]> {
  return db
    .select()
    .from(reconciliation)
    .where(
      and(
        eq(reconciliation.organizationId, query.organizationId),
        lte(reconciliation.periodStart, query.at),
        gte(reconciliation.periodEnd, query.at),
        query.scopeTypes === undefined || query.scopeTypes.length === 0
          ? undefined
          : inArray(reconciliation.scopeType, [...query.scopeTypes]),
      ),
    )
    .orderBy(desc(reconciliation.periodStart), desc(reconciliation.id));
}

export interface ReconciliationPatch {
  status?: string;
  resolutionNote?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
  updatedAt?: Date;
}

/**
 * Narrow, org-scoped update for the reconciliation lifecycle: status plus the
 * resolution trail (`resolution_note`, `owner_id`, `due_date`). The schema's
 * `reconciliation_status_check` still governs which statuses are legal. The
 * `organizationId` is part of the WHERE clause, so another tenant's row can
 * never be patched.
 */
export async function updateReconciliation(
  db: Database,
  query: FindReconciliationQuery,
  patch: ReconciliationPatch,
): Promise<Reconciliation | undefined> {
  const rows = await db
    .update(reconciliation)
    .set(patch)
    .where(
      and(
        eq(reconciliation.id, query.reconciliationId),
        eq(reconciliation.organizationId, query.organizationId),
      ),
    )
    .returning();
  return rows[0];
}

/*
 * `DEC-072` effective-dated tolerance configuration (`reconciliation_tolerance`,
 * migration `0024`). The table carries `organization_id` directly, so every read
 * and write is organization-scoped (`DEC-061`). The non-overlapping
 * `[effective_from, effective_to)` window is enforced by the
 * `reconciliation_tolerance_no_overlap` EXCLUDE constraint in `0024`; this
 * module stores and reads the config rows, it does not compute the applied
 * tolerance (`max(rate × |expected|, floor_amount)` is the application's job).
 */

export async function createReconciliationTolerance(
  db: Database,
  input: NewReconciliationTolerance,
): Promise<ReconciliationTolerance> {
  const rows = await db.insert(reconciliationTolerance).values(input).returning();
  return rows[0]!;
}

export interface FindReconciliationToleranceQuery {
  readonly organizationId: string;
  readonly kind: string;
  /** As-of date, `yyyy-mm-dd`; the effective row is the one containing it. */
  readonly asOf: string;
}

/**
 * The tolerance config for `(organizationId, kind)` effective at `asOf`, or
 * `undefined` when no row covers that date. The window is half-open
 * `[effective_from, effective_to)`: `effective_from <= asOf` and
 * `(effective_to IS NULL OR effective_to > asOf)`. The `effective_to` boundary
 * is **exclusive**: a row with `effective_to = X` is NOT effective at `X`; that
 * date belongs to the next window, so a same-day boundary belongs to the later
 * row only. The EXCLUDE constraint guarantees at most one match;
 * `effective_from` descending is a defensive tie-break.
 */
export async function findReconciliationTolerance(
  db: Database,
  query: FindReconciliationToleranceQuery,
): Promise<ReconciliationTolerance | undefined> {
  const rows = await db
    .select()
    .from(reconciliationTolerance)
    .where(
      and(
        eq(reconciliationTolerance.organizationId, query.organizationId),
        eq(reconciliationTolerance.kind, query.kind),
        lte(reconciliationTolerance.effectiveFrom, query.asOf),
        or(
          isNull(reconciliationTolerance.effectiveTo),
          gt(reconciliationTolerance.effectiveTo, query.asOf),
        ),
      ),
    )
    .orderBy(desc(reconciliationTolerance.effectiveFrom), desc(reconciliationTolerance.id))
    .limit(1);
  return rows[0];
}

export interface ListReconciliationTolerancesQuery {
  readonly organizationId: string;
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Tolerance config rows for one organization, newest effective first
 * (`effective_from`, then `id`), with an optional `kind` filter. Every filter is
 * optional except the organization, so the caller never sees another tenant's
 * rows. Paging is applied after the ordering.
 */
export async function listReconciliationTolerances(
  db: Database,
  query: ListReconciliationTolerancesQuery,
): Promise<ReconciliationTolerance[]> {
  const statement = db
    .select()
    .from(reconciliationTolerance)
    .where(
      and(
        eq(reconciliationTolerance.organizationId, query.organizationId),
        query.kind === undefined ? undefined : eq(reconciliationTolerance.kind, query.kind),
      ),
    )
    .orderBy(desc(reconciliationTolerance.effectiveFrom), desc(reconciliationTolerance.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
