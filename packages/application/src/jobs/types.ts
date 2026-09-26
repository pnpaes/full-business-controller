import type { AuditInput } from "../auth";

/**
 * `ADR-0004` (accepted 2026-09-26) shape **P2**: the jobs/outbox platform core.
 *
 * The transactional `outbox_event` table is the durable source of truth and the
 * dedup key is `outbox_event.id`; the runner queue (pg-boss, wired in a later
 * wave) is disposable and can be rebuilt by replaying unpublished outbox rows.
 * `job` is the application projection the API reads (the 202 job URL/progress
 * record), not the runner's own queue. This module never imports pg-boss: the
 * runtime supplies an {@link OutboxJobDispatcher} bound to the same transaction.
 *
 * Application-level idempotency is required in addition to the queue, so the
 * enqueue command dedups on the natural event key while the event is unpublished
 * (see `enqueue-outbox-event.ts`).
 */

/** The job status allow-list, mirrored by the `job_status_check` table check. */
export const JOB_STATUS = ["pending", "running", "succeeded", "failed", "dead_lettered"] as const;

export type JobStatus = (typeof JOB_STATUS)[number];

/** One `outbox_event` row as the ports see it. */
export interface OutboxEventRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
  readonly publishedAt: Date | null;
  readonly attempts: number;
  readonly deadLetteredAt: Date | null;
}

/** The fields a caller supplies to append one outbox event. */
export interface NewOutboxEventRecord {
  readonly organizationId: string;
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/** The natural dedup key: an unpublished event of this shape already exists. */
export interface UnpublishedOutboxKey {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
}

/** One `job` row as the ports see it. */
export interface JobRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly queue: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: string | null;
  readonly outboxEventId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date | null;
}

/** The fields a caller supplies to create a scheduled job projection. */
export interface NewJobRecord {
  readonly organizationId: string;
  readonly queue: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly scheduledAt?: Date | null;
  readonly maxAttempts?: number;
  readonly outboxEventId?: string | null;
  /** Stamped on `created_by`. */
  readonly actorId?: string | null;
}

export interface ListJobsQuery {
  readonly organizationId: string;
  readonly status?: JobStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The outbox write path. The five operations the platform core exposes are the
 * insert plus the four state transitions; `findUnpublishedByKey` is the read that
 * backs the enqueue dedup and `listUnpublished` is the queue-replay read. Both
 * `withTransaction` and `writeAudit` are here so the enqueue commits the event,
 * the projection, the dispatch and the audit atomically.
 */
export interface OutboxWriteStore {
  /**
   * Binds `fn` to one transaction (a nested call reuses the active transaction,
   * so the outbox, the job projection, the dispatch and the audit commit or roll
   * back together).
   */
  withTransaction<T>(fn: (store: JobStore) => Promise<T>): Promise<T>;
  /** The oldest unpublished event matching the natural key, or `undefined`. */
  findUnpublishedByKey(key: UnpublishedOutboxKey): Promise<OutboxEventRecord | undefined>;
  /** Appends one event row and returns it (its id is the dedup key). */
  insertOutboxEvent(input: NewOutboxEventRecord): Promise<OutboxEventRecord>;
  /** Stamps `published_at`; throws `DomainError` if the id is unknown. */
  markPublished(outboxEventId: string): Promise<void>;
  /** Increments `attempts`; throws `DomainError` if the id is unknown. */
  recordAttempt(outboxEventId: string): Promise<void>;
  /** Stamps `dead_lettered_at`; throws `DomainError` if the id is unknown. */
  deadLetter(outboxEventId: string): Promise<void>;
  /** The oldest unpublished events for one organization, bounded by `limit`. */
  listUnpublished(organizationId: string, limit: number): Promise<readonly OutboxEventRecord[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}

/**
 * The job-projection write path. Each status update is guarded at the database
 * (`pending -> running -> succeeded|failed|dead_lettered`); a scoped or illegal
 * miss returns `undefined` and the command raises a `DomainError`.
 */
export interface JobWriteStore {
  withTransaction<T>(fn: (store: JobStore) => Promise<T>): Promise<T>;
  createScheduledJob(input: NewJobRecord): Promise<JobRecord>;
  /** Marks the job running from `pending`/`failed`; stamps the attempt number. */
  markRunning(
    organizationId: string,
    jobId: string,
    attempt: number,
  ): Promise<JobRecord | undefined>;
  /** Marks the job succeeded (only from `running`). */
  markSucceeded(organizationId: string, jobId: string): Promise<JobRecord | undefined>;
  /** Marks the job failed (only from `running`). */
  markFailed(organizationId: string, jobId: string, error: string): Promise<JobRecord | undefined>;
  /** Marks the job dead-lettered (from `running`/`failed`). */
  markDeadLettered(
    organizationId: string,
    jobId: string,
    error: string,
  ): Promise<JobRecord | undefined>;
  writeAudit(input: AuditInput): Promise<void>;
}

/** The job-projection read path (organization is always required, `DEC-061`). */
export interface JobReadStore {
  findJobById(organizationId: string, jobId: string): Promise<JobRecord | undefined>;
  /** The projection for one outbox event; backs the idempotent enqueue return. */
  findJobByOutboxEventId(
    organizationId: string,
    outboxEventId: string,
  ): Promise<JobRecord | undefined>;
  listJobs(query: ListJobsQuery): Promise<readonly JobRecord[]>;
}

/**
 * The full store capability: both write paths, the audit sink and the reads a
 * command needs to load a row before transitioning it. `withTransaction` yields
 * this type so a transaction handle exposes every operation.
 */
export type JobStore = OutboxWriteStore & JobWriteStore & JobReadStore;

/** The store the enqueue command needs (`ADR-0004` P2 seam); the full capability. */
export type OutboxJobStore = JobStore;
