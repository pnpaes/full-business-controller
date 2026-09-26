import { DomainError } from "@aquarela/domain";
import { randomUUID } from "node:crypto";

import type { AuditInput } from "../auth";
import type { OutboxDispatchEvent, OutboxJobDispatcher } from "./dispatch";
import type {
  JobReadStore,
  JobRecord,
  JobStatus,
  ListJobsQuery,
  NewJobRecord,
  NewOutboxEventRecord,
  OutboxEventRecord,
  OutboxJobStore,
  UnpublishedOutboxKey,
} from "./types";

const RUNNING_FROM: readonly JobStatus[] = ["pending", "failed"];
const SUCCEEDED_FROM: readonly JobStatus[] = ["running"];
const FAILED_FROM: readonly JobStatus[] = ["running"];
const DEAD_LETTERED_FROM: readonly JobStatus[] = ["running", "failed"];

/**
 * In-memory store for the jobs/outbox unit suite. It mirrors the observable
 * contract (org-scoped lookups, the natural-key dedup, the guarded status
 * transitions) closely enough to exercise the commands without a database; the
 * postgres adapter is covered by `jobs.postgres.test.ts`.
 *
 * `withTransaction` snapshots the arrays and restores them on a throw, so the
 * dispatch-failure rollback is observable in a unit test exactly as it is against
 * Postgres.
 */
export class FakeJobStore implements OutboxJobStore, JobReadStore {
  outboxEvents: OutboxEventRecord[] = [];
  jobs: JobRecord[] = [];
  audits: AuditInput[] = [];

  async withTransaction<T>(fn: (store: OutboxJobStore) => Promise<T>): Promise<T> {
    const outboxSnapshot = [...this.outboxEvents];
    const jobsSnapshot = [...this.jobs];
    const auditsSnapshot = [...this.audits];
    try {
      return await fn(this);
    } catch (error) {
      this.outboxEvents = outboxSnapshot;
      this.jobs = jobsSnapshot;
      this.audits = auditsSnapshot;
      throw error;
    }
  }

  findUnpublishedByKey(key: UnpublishedOutboxKey): Promise<OutboxEventRecord | undefined> {
    const row = this.outboxEvents
      .filter(
        (event) =>
          event.organizationId === key.organizationId &&
          event.aggregateType === key.aggregateType &&
          event.aggregateId === key.aggregateId &&
          event.eventType === key.eventType &&
          event.publishedAt === null,
      )
      .sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
      )[0];
    return Promise.resolve(row);
  }

  insertOutboxEvent(input: NewOutboxEventRecord): Promise<OutboxEventRecord> {
    const record: OutboxEventRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      occurredAt: new Date(),
      publishedAt: null,
      attempts: 0,
      deadLetteredAt: null,
    };
    this.outboxEvents.push(record);
    return Promise.resolve(record);
  }

  markPublished(outboxEventId: string): Promise<void> {
    this.updateOutbox(outboxEventId, { publishedAt: new Date() });
    return Promise.resolve();
  }

  recordAttempt(outboxEventId: string): Promise<void> {
    const current = this.outboxEvents.find((event) => event.id === outboxEventId);
    if (current === undefined) {
      throw new DomainError(`outbox event ${outboxEventId} not found`);
    }
    this.updateOutbox(outboxEventId, { attempts: current.attempts + 1 });
    return Promise.resolve();
  }

  deadLetter(outboxEventId: string): Promise<void> {
    this.updateOutbox(outboxEventId, { deadLetteredAt: new Date() });
    return Promise.resolve();
  }

  private updateOutbox(outboxEventId: string, patch: Partial<OutboxEventRecord>): void {
    const index = this.outboxEvents.findIndex((event) => event.id === outboxEventId);
    if (index === -1) {
      throw new DomainError(`outbox event ${outboxEventId} not found`);
    }
    this.outboxEvents[index] = { ...this.outboxEvents[index]!, ...patch };
  }

  listUnpublished(organizationId: string, limit: number): Promise<readonly OutboxEventRecord[]> {
    const rows = this.outboxEvents
      .filter((event) => event.organizationId === organizationId && event.publishedAt === null)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit);
    return Promise.resolve(rows);
  }

  createScheduledJob(input: NewJobRecord): Promise<JobRecord> {
    const record: JobRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      queue: input.queue,
      kind: input.kind,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      scheduledAt: input.scheduledAt ?? null,
      startedAt: null,
      finishedAt: null,
      error: null,
      outboxEventId: input.outboxEventId ?? null,
      createdAt: new Date(),
      updatedAt: null,
    };
    this.jobs.push(record);
    return Promise.resolve(record);
  }

  markRunning(
    organizationId: string,
    jobId: string,
    attempt: number,
  ): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.transition(organizationId, jobId, RUNNING_FROM, (job) => ({
        ...job,
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        attempts: attempt,
        updatedAt: new Date(),
      })),
    );
  }

  markSucceeded(organizationId: string, jobId: string): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.transition(organizationId, jobId, SUCCEEDED_FROM, (job) => ({
        ...job,
        status: "succeeded",
        finishedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })),
    );
  }

  markFailed(organizationId: string, jobId: string, error: string): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.transition(organizationId, jobId, FAILED_FROM, (job) => ({
        ...job,
        status: "failed",
        finishedAt: new Date(),
        error,
        updatedAt: new Date(),
      })),
    );
  }

  markDeadLettered(
    organizationId: string,
    jobId: string,
    error: string,
  ): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.transition(organizationId, jobId, DEAD_LETTERED_FROM, (job) => ({
        ...job,
        status: "dead_lettered",
        finishedAt: new Date(),
        error,
        updatedAt: new Date(),
      })),
    );
  }

  private transition(
    organizationId: string,
    jobId: string,
    from: readonly JobStatus[],
    next: (job: JobRecord) => JobRecord,
  ): JobRecord | undefined {
    const index = this.jobs.findIndex(
      (job) => job.id === jobId && job.organizationId === organizationId,
    );
    if (index === -1) {
      return undefined;
    }
    const current = this.jobs[index]!;
    if (!from.includes(current.status)) {
      return undefined;
    }
    const updated = next(current);
    this.jobs[index] = updated;
    return updated;
  }

  findJobById(organizationId: string, jobId: string): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.jobs.find((job) => job.id === jobId && job.organizationId === organizationId),
    );
  }

  findJobByOutboxEventId(
    organizationId: string,
    outboxEventId: string,
  ): Promise<JobRecord | undefined> {
    return Promise.resolve(
      this.jobs.find(
        (job) => job.organizationId === organizationId && job.outboxEventId === outboxEventId,
      ),
    );
  }

  listJobs(query: ListJobsQuery): Promise<readonly JobRecord[]> {
    const offset = query.offset ?? 0;
    const rows = this.jobs
      .filter(
        (job) =>
          job.organizationId === query.organizationId &&
          (query.status === undefined || job.status === query.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(offset, query.limit === undefined ? undefined : offset + query.limit);
    return Promise.resolve(rows);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}

/** Records dispatched events; `failNext` makes the next dispatch throw (rollback test). */
export class FakeOutboxJobDispatcher implements OutboxJobDispatcher {
  readonly dispatched: OutboxDispatchEvent[] = [];
  failNext: Error | undefined;

  dispatch(event: OutboxDispatchEvent): Promise<void> {
    if (this.failNext !== undefined) {
      const error = this.failNext;
      this.failNext = undefined;
      return Promise.reject(error);
    }
    this.dispatched.push(event);
    return Promise.resolve();
  }
}
