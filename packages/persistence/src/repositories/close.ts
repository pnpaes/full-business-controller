import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../client";
import { periodClose } from "../schema";

export type PeriodClose = typeof periodClose.$inferSelect;

/*
 * `REC-003`/`REC-006`, `DEC-027` (row 13a): the close/lock slice repository.
 *
 * `period_close` carries `organization_id` directly, so every read and write
 * that takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row. `scope_id` is a plain uuid (a `location` or the
 * organization, by `scope_type`); the `0058` `period_close_scope_org_guard`
 * trigger keeps a `location` scope in the row's own organization, so this layer
 * does not re-check it.
 *
 * This layer exposes **no delete command** (a locked row is delete-blocked at
 * the database) and writes **no** `audit_event` (the row is mutable, not
 * append-only); the application writes the audit facts. The vocabulary columns,
 * the period/granularity/actor-pair checks and the
 * `(organization_id, scope_type, scope_id, period_start)` unique are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so callers see a `DomainError`.
 */

export interface CreatePeriodCloseInput {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPE`. */
  readonly scopeType: string;
  /** The `location.id` (location scope) or `organization.id` (company scope). */
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`; `>= periodStart` and granularity-consistent. */
  readonly periodEnd: string;
  /** One of `PERIOD_CLOSE_STATUS`; the column default is `open` when omitted. */
  readonly status?: string;
  /** The close-task list (jsonb array; stored verbatim). */
  readonly checklist: unknown;
  /** The frozen closure snapshot, or `null` before closure begins. */
  readonly snapshot?: unknown;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/**
 * Creates one `period_close` row. `organizationId` is supplied by the caller;
 * `status` takes the column default `open` when omitted and the granularity/
 * period checks are enforced at the database.
 */
export async function createPeriodClose(
  db: Database,
  input: CreatePeriodCloseInput,
): Promise<PeriodClose> {
  const rows = await db
    .insert(periodClose)
    .values({
      organizationId: input.organizationId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ...(input.status === undefined ? {} : { status: input.status }),
      checklist: input.checklist,
      snapshot: input.snapshot ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindPeriodCloseQuery {
  readonly organizationId: string;
  readonly periodCloseId: string;
}

/** One `period_close` row by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findPeriodClose(
  db: Database,
  query: FindPeriodCloseQuery,
): Promise<PeriodClose | undefined> {
  const rows = await db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.id, query.periodCloseId),
        eq(periodClose.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped id select as `findPeriodClose`, but taking the row's write
 * lock (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction. A
 * missing or cross-organization id returns `undefined` without locking. The
 * lifecycle commands (`lockPeriodClose`/`reopenPeriodClose`) resolve the row
 * through this lock so two concurrent transitions serialise instead of both
 * passing the status check and both writing an audit fact.
 */
export async function lockPeriodCloseById(
  db: Database,
  query: FindPeriodCloseQuery,
): Promise<PeriodClose | undefined> {
  const rows = await db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.id, query.periodCloseId),
        eq(periodClose.organizationId, query.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

export interface FindPeriodCloseForScopeQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPE`. */
  readonly scopeType: string;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
}

/**
 * One `period_close` row for a scope and period, organization-scoped
 * (`DEC-061`), or `undefined`. `(organization_id, scope_type, scope_id,
 * period_start)` is the unique key, so no id is needed.
 */
export async function findPeriodCloseForScope(
  db: Database,
  query: FindPeriodCloseForScopeQuery,
): Promise<PeriodClose | undefined> {
  const rows = await db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.organizationId, query.organizationId),
        eq(periodClose.scopeType, query.scopeType),
        eq(periodClose.scopeId, query.scopeId),
        eq(periodClose.periodStart, query.periodStart),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped, scope-and-period select as `findPeriodCloseForScope`, but
 * taking the row's write lock (`SELECT … FOR UPDATE`) for the rest of the
 * surrounding transaction. A scope with no row returns `undefined` without
 * locking. `beginPeriodClose` locks the scope row first, so two concurrent
 * begins for one scope serialise instead of both passing the existence check and
 * colliding on the unique (23505).
 */
export async function lockPeriodCloseForScope(
  db: Database,
  query: FindPeriodCloseForScopeQuery,
): Promise<PeriodClose | undefined> {
  const rows = await db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.organizationId, query.organizationId),
        eq(periodClose.scopeType, query.scopeType),
        eq(periodClose.scopeId, query.scopeId),
        eq(periodClose.periodStart, query.periodStart),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

export interface ListPeriodClosesQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPE`, exact match. */
  readonly scopeType?: string;
  readonly scopeId?: string;
  /** One of `PERIOD_CLOSE_STATUS`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start` (`>= from`); `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `period_start` (`<= to`); `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `period_close` rows for one organization, newest period first (`period_start
 * desc`, then `id asc`), with optional scope, status and `period_start` window
 * filters (`from`/`to` inclusive). The organization filter is never optional
 * (`DEC-061`); paging is applied after the ordering.
 */
export async function listPeriodCloses(
  db: Database,
  query: ListPeriodClosesQuery,
): Promise<readonly PeriodClose[]> {
  const statement = db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.organizationId, query.organizationId),
        query.scopeType === undefined ? undefined : eq(periodClose.scopeType, query.scopeType),
        query.scopeId === undefined ? undefined : eq(periodClose.scopeId, query.scopeId),
        query.status === undefined ? undefined : eq(periodClose.status, query.status),
        query.from === undefined ? undefined : gte(periodClose.periodStart, query.from),
        query.to === undefined ? undefined : lte(periodClose.periodStart, query.to),
      ),
    )
    .orderBy(desc(periodClose.periodStart), asc(periodClose.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface UpdatePeriodCloseInput {
  readonly organizationId: string;
  readonly periodCloseId: string;
  /** One of `PERIOD_CLOSE_STATUS`. */
  readonly status?: string;
  /** Replaces the close-task list; an omitted field is untouched. */
  readonly checklist?: unknown;
  /** Replaces the frozen snapshot; an explicit `null` clears it. */
  readonly snapshot?: unknown;
  /** Explicit `null` clears the policy; an omitted field is untouched. */
  readonly correctionPolicy?: string | null;
  readonly lockedBy?: string | null;
  readonly lockedAt?: Date | null;
  readonly reopenedBy?: string | null;
  readonly reopenedAt?: Date | null;
  readonly reopenReason?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one `period_close` row's mutable fields, organization-scoped
 * (`DEC-061`). A field left out of the patch is untouched (drizzle skips
 * `undefined`), while an explicit value replaces it and an explicit `null`
 * clears a nullable column; the audit columns record the amendment.
 * `scope_type`/`scope_id`/`period_start`/`period_end` are immutable after
 * creation (a locked row is immutable at the database too, `0058`), and the id
 * alone cannot address another tenant's row — a missing or cross-organization id
 * returns `undefined`, exactly like `findPeriodClose`.
 */
export async function updatePeriodClose(
  db: Database,
  input: UpdatePeriodCloseInput,
): Promise<PeriodClose | undefined> {
  const { organizationId, periodCloseId, actorId, ...patch } = input;
  const rows = await db
    .update(periodClose)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(periodClose.id, periodCloseId), eq(periodClose.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface FindLockedPeriodCloseCoveringDateQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPE`. */
  readonly scopeType: string;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`; matched inclusively against `[period_start, period_end]`. */
  readonly at: string;
}

/**
 * The `locked` `period_close` row whose period contains `at`, organization- and
 * scope-scoped (`DEC-061`), or `undefined`. Used to answer "is this date locked
 * for this scope?" (`REC-006`); a `closing`/`reopened`/`open` row does not lock
 * anything, so only `status = 'locked'` matches. Both bounds are inclusive.
 */
export async function findLockedPeriodCloseCoveringDate(
  db: Database,
  query: FindLockedPeriodCloseCoveringDateQuery,
): Promise<PeriodClose | undefined> {
  const rows = await db
    .select()
    .from(periodClose)
    .where(
      and(
        eq(periodClose.organizationId, query.organizationId),
        eq(periodClose.scopeType, query.scopeType),
        eq(periodClose.scopeId, query.scopeId),
        eq(periodClose.status, "locked"),
        lte(periodClose.periodStart, query.at),
        gte(periodClose.periodEnd, query.at),
      ),
    )
    .limit(1);
  return rows[0];
}
