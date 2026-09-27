import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "../client";
import { job } from "../schema";

export type Job = typeof job.$inferSelect;
export type NewJob = typeof job.$inferInsert;

/*
 * `ADR-0004` (accepted 2026-09-26) shape **P2**: the `job` table is the
 * application job projection (the API-facing 202 job URL/progress record), not
 * the runner's own queue. It carries `organization_id` directly, so every read
 * and write that takes the organization is scoped by it (`DEC-061`): a row in
 * another organization is invisible, and a scoped miss returns `undefined`
 * rather than surfacing another tenant's row.
 *
 * Status transitions are guarded in the `UPDATE` predicate (the row lock plus the
 * guard are the concurrency authority): a terminal `succeeded`/`dead_lettered`
 * row can never be moved back, and a job cannot succeed without first running. A
 * guarded update that matches nothing returns `undefined`, which the application
 * command maps to a `DomainError`.
 */

/** The non-terminal statuses a `running` mark may come from (a failed job may retry). */
const RUNNING_FROM = ["pending", "failed"];
/** The only status a job may succeed from. */
const SUCCEEDED_FROM = ["running"];
/** A failure is recorded only after the job was marked running. */
const FAILED_FROM = ["running"];
/** A dead-letter follows a failed attempt, whether or not the failure was recorded first. */
const DEAD_LETTERED_FROM = ["running", "failed"];
/** The only status an operator DLQ review may retry or discard from. */
const DEAD_LETTERED_ONLY = ["dead_lettered"];
/** The terminal statuses eligible for retention pruning; non-terminal rows are never deleted. */
const PRUNABLE_STATUSES = ["succeeded", "failed", "dead_lettered"] as const;
/** The non-terminal statuses an aged row is stuck in (a lost delivery, not garbage). */
const NON_TERMINAL_STATUSES = ["pending", "running"] as const;

/** Creates one scheduled job projection; `outbox_event_id` links it to its event. */
export async function createScheduledJob(db: Database, input: NewJob): Promise<Job> {
  const rows = await db.insert(job).values(input).returning();
  return rows[0]!;
}

export interface FindJobQuery {
  readonly organizationId: string;
  readonly jobId: string;
}

/** One job by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findJobById(db: Database, query: FindJobQuery): Promise<Job | undefined> {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.id, query.jobId), eq(job.organizationId, query.organizationId)))
    .limit(1);
  return rows[0];
}

export interface FindJobByOutboxEventQuery {
  readonly organizationId: string;
  readonly outboxEventId: string;
}

/**
 * The projection row for one outbox event, organization-scoped, or `undefined`.
 * Backs the idempotent enqueue return: a duplicate enqueue re-reads the existing
 * job instead of inserting a second one.
 */
export async function findJobByOutboxEventId(
  db: Database,
  query: FindJobByOutboxEventQuery,
): Promise<Job | undefined> {
  const rows = await db
    .select()
    .from(job)
    .where(
      and(eq(job.organizationId, query.organizationId), eq(job.outboxEventId, query.outboxEventId)),
    )
    .limit(1);
  return rows[0];
}

export interface ListJobsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's jobs, newest `created_at` first (then id), with the bounded
 * paging idiom (`$dynamic()`). The organization filter is never optional
 * (`DEC-061`); `status` is an optional narrowing filter.
 */
export async function listJobs(db: Database, query: ListJobsQuery): Promise<readonly Job[]> {
  const statement = db
    .select()
    .from(job)
    .where(
      and(
        eq(job.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(job.status, query.status),
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface MarkJobRunningInput {
  readonly organizationId: string;
  readonly jobId: string;
  /** The current attempt number, `>= 1` (validated by the application). */
  readonly attempt: number;
}

/**
 * Marks one organization-owned job `running`: status, `started_at`, the attempt
 * number, and clears any earlier `finished_at`/`error`. `undefined` if the row is
 * unknown, belongs to another organization, or is not in a runnable status.
 */
export async function markJobRunning(
  db: Database,
  input: MarkJobRunningInput,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({
      status: "running",
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      attempts: input.attempt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.organizationId, input.organizationId),
        inArray(job.status, RUNNING_FROM),
      ),
    )
    .returning();
  return rows[0];
}

/** Marks one org-owned job `succeeded` (only from `running`); `undefined` on a scoped/illegal miss. */
export async function markJobSucceeded(
  db: Database,
  query: FindJobQuery,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({ status: "succeeded", finishedAt: new Date(), error: null, updatedAt: new Date() })
    .where(
      and(
        eq(job.id, query.jobId),
        eq(job.organizationId, query.organizationId),
        inArray(job.status, SUCCEEDED_FROM),
      ),
    )
    .returning();
  return rows[0];
}

export interface MarkJobFailedInput {
  readonly organizationId: string;
  readonly jobId: string;
  readonly error: string;
}

/** Marks one org-owned job `failed` (only from `running`); `undefined` on a scoped/illegal miss. */
export async function markJobFailed(
  db: Database,
  input: MarkJobFailedInput,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: input.error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.organizationId, input.organizationId),
        inArray(job.status, FAILED_FROM),
      ),
    )
    .returning();
  return rows[0];
}

/** Marks one org-owned job `dead_lettered`; `undefined` on a scoped/illegal miss. */
export async function markJobDeadLettered(
  db: Database,
  input: MarkJobFailedInput,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({
      status: "dead_lettered",
      finishedAt: new Date(),
      error: input.error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.organizationId, input.organizationId),
        inArray(job.status, DEAD_LETTERED_FROM),
      ),
    )
    .returning();
  return rows[0];
}

export interface ResetDeadLetteredJobInput {
  readonly organizationId: string;
  readonly jobId: string;
}

/**
 * Operator DLQ review, **retry**: moves a `dead_lettered` job back to `pending`
 * for a fresh delivery, resetting the attempt count and clearing the terminal
 * `started_at`/`finished_at`/`error`. The status guard lives in the `UPDATE`
 * predicate, so only a currently `dead_lettered` row moves — a concurrent
 * transition (or a second retry) matches nothing and returns `undefined`, which
 * the command maps to a `DomainError`. Organization-scoped (`DEC-061`).
 */
export async function resetDeadLetteredJob(
  db: Database,
  input: ResetDeadLetteredJobInput,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({
      status: "pending",
      attempts: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.organizationId, input.organizationId),
        inArray(job.status, DEAD_LETTERED_ONLY),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Operator DLQ review, **discard**: moves a `dead_lettered` job to the terminal
 * `failed` status. `markJobFailed` cannot do this — it only moves a `running`
 * row — so this is a dedicated guarded transition; the recorded `error` and
 * `finished_at` are kept as the review evidence. The outbox row is left for the
 * caller (the command stamps it published so the replay cannot resurrect the
 * discarded job, while `dead_lettered_at` stays as the review marker). Only a
 * currently `dead_lettered` row moves; org-scoped (`DEC-061`).
 */
export async function discardDeadLetteredJob(
  db: Database,
  input: ResetDeadLetteredJobInput,
): Promise<Job | undefined> {
  const rows = await db
    .update(job)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.organizationId, input.organizationId),
        inArray(job.status, DEAD_LETTERED_ONLY),
      ),
    )
    .returning();
  return rows[0];
}

export interface DeleteExpiredJobsInput {
  readonly organizationId: string;
  readonly olderThan: Date;
  /** The maximum rows to delete in one call; the prune is batched by the caller. */
  readonly limit: number;
}

/**
 * Retention prune: deletes **terminal** job projections (`succeeded`/`failed`/
 * `dead_lettered`) whose `created_at` is older than `olderThan`, organization-
 * scoped and capped at `limit` rows, returning the count deleted.
 *
 * Terminal-only: an old `pending`/`running` row is an anomaly (a stuck or lost
 * delivery), not garbage — deleting it would erase the evidence, so the
 * maintenance handler surfaces it via {@link countStuckJobs} (`jobs.stuck_pending`)
 * instead. The monitor cannot do it: it reads only pg-boss, and the divergence
 * case is a projection whose pg-boss job vanished (consumer crashed). Non-terminal
 * rows are never touched here.
 *
 * Organization-scoped because every `job` read/write is (`DEC-061`). The prune
 * range-scans `job_org_created_at_idx (organization_id, created_at)` and filters
 * terminal statuses (`succeeded`/`failed`/`dead_lettered`).
 */
export async function deleteExpiredJobs(
  db: Database,
  input: DeleteExpiredJobsInput,
): Promise<number> {
  const expiredIds = db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.organizationId, input.organizationId),
        inArray(job.status, [...PRUNABLE_STATUSES]),
        lt(job.createdAt, input.olderThan),
      ),
    )
    .limit(input.limit);
  const deleted = await db.delete(job).where(inArray(job.id, expiredIds)).returning({ id: job.id });
  return deleted.length;
}

export interface CountStuckJobsInput {
  readonly organizationId: string;
  /** Rows created before this instant are old enough to be stuck. */
  readonly olderThan: Date;
}

/**
 * Counts **non-terminal** job projections (`pending`/`running`) whose `created_at`
 * is older than `olderThan`, organization-scoped (`DEC-061`).
 *
 * This covers the divergence the retention prune deliberately preserves: when a
 * consumer crashes after claiming a job, the pg-boss job can vanish while the
 * projection stays `pending`/`running` forever. The monitor reads only pg-boss, so
 * it can never see that row — the maintenance handler calls this and raises
 * `jobs.stuck_pending`. The cut is `created_at`, not `started_at`, so a row that
 * was never claimed also counts. Org-scoped like every `job` read; the terminal-only
 * prune never removes these rows, so an aged one keeps counting until resolved.
 */
export async function countStuckJobs(db: Database, input: CountStuckJobsInput): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(job)
    .where(
      and(
        eq(job.organizationId, input.organizationId),
        inArray(job.status, [...NON_TERMINAL_STATUSES]),
        lt(job.createdAt, input.olderThan),
      ),
    );
  return rows[0]?.count ?? 0;
}
