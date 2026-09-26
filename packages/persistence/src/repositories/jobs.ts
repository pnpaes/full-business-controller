import { and, desc, eq, inArray } from "drizzle-orm";

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
