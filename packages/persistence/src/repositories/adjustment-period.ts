import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../client";
import { adjustmentPeriod } from "../schema";

export type AdjustmentPeriod = typeof adjustmentPeriod.$inferSelect;

/*
 * `REC-006`, `DEC-027` (row 13b): the adjustment-period slice repository.
 *
 * `adjustment_period` carries `organization_id` directly, so every read and
 * write that takes the organization is scoped by it (`DEC-061`). A row in
 * another organization is invisible at this scope: reads and updates match on
 * `id` **and** `organization_id`, and a scoped miss returns `undefined` rather
 * than surfacing another tenant's row. The table has no location dimension, so
 * there is no location scope to enforce here.
 *
 * This layer exposes **no delete command** and writes **no** `audit_event` (the
 * row is mutable, not append-only); the application writes the audit facts. The
 * status vocabulary, the `opened_to >= opened_from` and all-or-nothing approval
 * checks and the partial unique `adjustment_period_open_key` are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so callers see a `DomainError`.
 */

export interface CreateAdjustmentPeriodInput {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly openedFrom: string;
  /** `date`, `YYYY-MM-DD`; `>= openedFrom`. */
  readonly openedTo: string;
  readonly reason: string;
  /** One of `ADJUSTMENT_PERIOD_STATUS`; the column default is `open` when omitted. */
  readonly status?: string;
  /** The approving actor; recorded with `approvedAt` or not at all (the check pair). */
  readonly approvedBy?: string | null;
  /** `timestamptz`; recorded with `approvedBy` or not at all (the check pair). */
  readonly approvedAt?: Date | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/**
 * Creates one `adjustment_period` row. `organizationId` is supplied by the
 * caller; `status` takes the column default `open` when omitted. The partial
 * unique `adjustment_period_open_key` rejects a second `open` row for the
 * organization (23505), which `openAdjustmentPeriod` handles as a create race.
 */
export async function createAdjustmentPeriod(
  db: Database,
  input: CreateAdjustmentPeriodInput,
): Promise<AdjustmentPeriod> {
  const rows = await db
    .insert(adjustmentPeriod)
    .values({
      organizationId: input.organizationId,
      openedFrom: input.openedFrom,
      openedTo: input.openedTo,
      reason: input.reason,
      ...(input.status === undefined ? {} : { status: input.status }),
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindAdjustmentPeriodQuery {
  readonly organizationId: string;
  readonly adjustmentPeriodId: string;
}

/** One `adjustment_period` row by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findAdjustmentPeriod(
  db: Database,
  query: FindAdjustmentPeriodQuery,
): Promise<AdjustmentPeriod | undefined> {
  const rows = await db
    .select()
    .from(adjustmentPeriod)
    .where(
      and(
        eq(adjustmentPeriod.id, query.adjustmentPeriodId),
        eq(adjustmentPeriod.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped id select as `findAdjustmentPeriod`, but taking the row's
 * write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction.
 * A missing or cross-organization id returns `undefined` without locking.
 * `closeAdjustmentPeriod` resolves the row through this lock so two concurrent
 * closes serialise instead of both passing the status check and both writing an
 * audit fact.
 */
export async function lockAdjustmentPeriodById(
  db: Database,
  query: FindAdjustmentPeriodQuery,
): Promise<AdjustmentPeriod | undefined> {
  const rows = await db
    .select()
    .from(adjustmentPeriod)
    .where(
      and(
        eq(adjustmentPeriod.id, query.adjustmentPeriodId),
        eq(adjustmentPeriod.organizationId, query.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

/**
 * The organization's `open` adjustment period, or `undefined`. The partial unique
 * `adjustment_period_open_key` guarantees at most one, so this read is a single
 * row; it backs both the `openAdjustmentPeriod` refusal and its create-race
 * re-read.
 */
export async function findOpenAdjustmentPeriod(
  db: Database,
  query: { readonly organizationId: string },
): Promise<AdjustmentPeriod | undefined> {
  const rows = await db
    .select()
    .from(adjustmentPeriod)
    .where(
      and(
        eq(adjustmentPeriod.organizationId, query.organizationId),
        eq(adjustmentPeriod.status, "open"),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListAdjustmentPeriodsQuery {
  readonly organizationId: string;
  /** One of `ADJUSTMENT_PERIOD_STATUS`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `opened_from` (`>= from`); `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `opened_from` (`<= to`); `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `adjustment_period` rows for one organization, newest window first
 * (`opened_from desc`, then `id asc`), with optional status and `opened_from`
 * window filters (`from`/`to` inclusive). The organization filter is never
 * optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listAdjustmentPeriods(
  db: Database,
  query: ListAdjustmentPeriodsQuery,
): Promise<readonly AdjustmentPeriod[]> {
  const statement = db
    .select()
    .from(adjustmentPeriod)
    .where(
      and(
        eq(adjustmentPeriod.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(adjustmentPeriod.status, query.status),
        query.from === undefined ? undefined : gte(adjustmentPeriod.openedFrom, query.from),
        query.to === undefined ? undefined : lte(adjustmentPeriod.openedFrom, query.to),
      ),
    )
    .orderBy(desc(adjustmentPeriod.openedFrom), asc(adjustmentPeriod.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface UpdateAdjustmentPeriodInput {
  readonly organizationId: string;
  readonly adjustmentPeriodId: string;
  /** One of `ADJUSTMENT_PERIOD_STATUS`. */
  readonly status?: string;
  readonly approvedBy?: string | null;
  readonly approvedAt?: Date | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one `adjustment_period` row's mutable fields, organization-scoped
 * (`DEC-061`). A field left out of the patch is untouched (drizzle skips
 * `undefined`), while an explicit value replaces it and an explicit `null`
 * clears a nullable column; the audit columns record the amendment.
 * `opened_from`/`opened_to`/`reason` are immutable after creation, and the id
 * alone cannot address another tenant's row — a missing or cross-organization id
 * returns `undefined`, exactly like `findAdjustmentPeriod`.
 *
 * ponytail: `approvedBy`/`approvedAt` are patchable (including clears) for the
 * planned two-stage approval flow (open → approved), but no current command uses
 * the clears. Ceiling: dead patch surface until that flow exists. Upgrade path:
 * keep the columns, drop the clears (or add the dedicated `approve` command) once
 * the two-stage flow is the only writer.
 */
export async function updateAdjustmentPeriod(
  db: Database,
  input: UpdateAdjustmentPeriodInput,
): Promise<AdjustmentPeriod | undefined> {
  const { organizationId, adjustmentPeriodId, actorId, ...patch } = input;
  const rows = await db
    .update(adjustmentPeriod)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(adjustmentPeriod.id, adjustmentPeriodId),
        eq(adjustmentPeriod.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}
