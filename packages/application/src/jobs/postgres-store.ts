import { DomainError } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  JobReadStore,
  JobRecord,
  NewJobRecord,
  NewOutboxEventRecord,
  OutboxEventRecord,
  OutboxJobStore,
  UnpublishedOutboxKey,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toOutboxRecord(row: repo.OutboxEvent): OutboxEventRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload,
    occurredAt: row.occurredAt,
    publishedAt: row.publishedAt,
    attempts: row.attempts,
    deadLetteredAt: row.deadLetteredAt,
  };
}

function toJobRecord(row: repo.Job): JobRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    queue: row.queue,
    kind: row.kind,
    payload: row.payload,
    status: row.status as JobRecord["status"],
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    outboxEventId: row.outboxEventId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNewJob(input: NewJobRecord): repo.NewJob {
  return {
    organizationId: input.organizationId,
    queue: input.queue,
    kind: input.kind,
    payload: input.payload,
    ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    ...(input.outboxEventId === undefined ? {} : { outboxEventId: input.outboxEventId }),
    createdBy: input.actorId ?? null,
  };
}

/**
 * Adapts the `job` and `outbox_event` tables (through the persistence
 * repositories) to the jobs/outbox ports over Drizzle. Every method runs on the
 * handle it was created with, so the store built inside `withTransaction` is
 * bound to that transaction — the enqueue's outbox insert, job projection,
 * dispatch and audit all share one transaction (the `ADR-0004` P2 seam).
 */
export function createPostgresJobStore(db: Database): OutboxJobStore & JobReadStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresJobStore(db));
      }
      return db.transaction((tx) => fn(createPostgresJobStore(tx)));
    },
    findUnpublishedByKey: async (key: UnpublishedOutboxKey) => {
      const row = await repo.findUnpublishedOutboxEventByKey(db, key);
      return row === undefined ? undefined : toOutboxRecord(row);
    },
    insertOutboxEvent: async (input: NewOutboxEventRecord) => {
      const row = await repo.insertOutboxEvent(db, {
        organizationId: input.organizationId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        ...(input.eventVersion === undefined ? {} : { eventVersion: input.eventVersion }),
      });
      return toOutboxRecord(row);
    },
    markPublished: async (outboxEventId: string) => {
      const row = await repo.markOutboxEventPublished(db, outboxEventId);
      if (row === undefined) {
        throw new DomainError(`outbox event ${outboxEventId} not found`);
      }
    },
    recordAttempt: async (outboxEventId: string) => {
      const row = await repo.recordOutboxEventAttempt(db, outboxEventId);
      if (row === undefined) {
        throw new DomainError(`outbox event ${outboxEventId} not found`);
      }
    },
    deadLetter: async (outboxEventId: string) => {
      const row = await repo.deadLetterOutboxEvent(db, outboxEventId);
      if (row === undefined) {
        throw new DomainError(`outbox event ${outboxEventId} not found`);
      }
    },
    clearDeadLetter: async (organizationId: string, outboxEventId: string) => {
      return repo.clearOutboxDeadLetter(db, { organizationId, outboxEventId });
    },
    listUnpublished: async (organizationId: string, limit: number) => {
      const rows = await repo.listUnpublishedOutboxEvents(db, organizationId, limit);
      return rows.map(toOutboxRecord);
    },
    createScheduledJob: async (input: NewJobRecord) => {
      const row = await repo.createScheduledJob(db, toNewJob(input));
      return toJobRecord(row);
    },
    markRunning: async (organizationId: string, jobId: string, attempt: number) => {
      const row = await repo.markJobRunning(db, { organizationId, jobId, attempt });
      return row === undefined ? undefined : toJobRecord(row);
    },
    markSucceeded: async (organizationId: string, jobId: string) => {
      const row = await repo.markJobSucceeded(db, { organizationId, jobId });
      return row === undefined ? undefined : toJobRecord(row);
    },
    markFailed: async (organizationId: string, jobId: string, error: string) => {
      const row = await repo.markJobFailed(db, { organizationId, jobId, error });
      return row === undefined ? undefined : toJobRecord(row);
    },
    markDeadLettered: async (organizationId: string, jobId: string, error: string) => {
      const row = await repo.markJobDeadLettered(db, { organizationId, jobId, error });
      return row === undefined ? undefined : toJobRecord(row);
    },
    resetDeadLetteredJob: async (organizationId: string, jobId: string) => {
      const row = await repo.resetDeadLetteredJob(db, { organizationId, jobId });
      return row === undefined ? undefined : toJobRecord(row);
    },
    discardDeadLetteredJob: async (organizationId: string, jobId: string) => {
      const row = await repo.discardDeadLetteredJob(db, { organizationId, jobId });
      return row === undefined ? undefined : toJobRecord(row);
    },
    deleteExpiredJobs: async (organizationId: string, olderThan: Date, limit: number) => {
      return repo.deleteExpiredJobs(db, { organizationId, olderThan, limit });
    },
    countStuckJobs: async (organizationId: string, olderThan: Date) => {
      return repo.countStuckJobs(db, { organizationId, olderThan });
    },
    findJobById: async (organizationId: string, jobId: string) => {
      const row = await repo.findJobById(db, { organizationId, jobId });
      return row === undefined ? undefined : toJobRecord(row);
    },
    findJobByOutboxEventId: async (organizationId: string, outboxEventId: string) => {
      const row = await repo.findJobByOutboxEventId(db, { organizationId, outboxEventId });
      return row === undefined ? undefined : toJobRecord(row);
    },
    listJobs: async (query) => {
      const rows = await repo.listJobs(db, query);
      return rows.map(toJobRecord);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
