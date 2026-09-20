import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { reconciliation } from "../schema";

export type Reconciliation = typeof reconciliation.$inferSelect;
export type NewReconciliation = typeof reconciliation.$inferInsert;

/*
 * Slice-12 reconciliation reads/writes (`REC-001`, `REC-005`; `DEC-026`,
 * `DEC-035`).
 *
 * `reconciliation` carries `organization_id` directly, so every read and write
 * is organization-scoped (`DEC-061`). `tolerance` is a per-row snapshot: there
 * is no tolerance-configuration table (A3, open point (d)), so nothing here
 * resolves an effective-dated tolerance and a missing tolerance does not block
 * close. `scope_type` is unconstrained text (open point (j)) and `scope_id` is a
 * polymorphic plain uuid. Only the status/resolution trail is mutable; the
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
