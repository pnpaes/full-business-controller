import {
  JOB_AUDIT_ACTIONS,
  JOB_ENTITY_TYPE,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@aquarela/application";
import type { JobStatus, JobStore } from "@aquarela/application";
import type { Database } from "@aquarela/persistence";
import type { Job, WorkHandler } from "pg-boss";

import type { RuntimeLogger } from "./logging";
import type { OutboxJobPayload } from "./queues";

/**
 * The non-external proof consumer registry (`ADR-0004` P2 first slice). One
 * handler per event type; the queue name is derived from the event type, so the
 * registry's keys are the queues the worker works.
 */
export interface OutboxJobContext {
  readonly organizationId: string;
  readonly outboxEventId: string;
  readonly eventType: string;
  readonly payload: OutboxJobPayload;
  readonly store: JobStore;
  /**
   * The root database handle the worker was started with, so a real handler can
   * build its own domain store on the same connection. Optional: the fake path
   * (`createOutboxConsumer({ store, handlers })`) omits it, so a handler that
   * needs it must say so and fail closed when it is absent.
   */
  readonly db?: Database;
  readonly logger?: RuntimeLogger;
}

export type OutboxJobHandler = (context: OutboxJobContext) => Promise<void>;

export type OutboxHandlerRegistry = Readonly<Record<string, OutboxJobHandler>>;

export interface OutboxConsumerOptions {
  readonly store: JobStore;
  readonly handlers: OutboxHandlerRegistry;
  /** The root database handle handed to handlers that need to build a store. */
  readonly db?: Database;
  readonly logger?: RuntimeLogger;
}

const SETTLED_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(["succeeded", "dead_lettered"]);

/**
 * The worker-side consumer. pg-boss delivers an **array** of jobs to a handler;
 * each job is processed through the application job projection so the outbox and
 * the projection stay consistent, and so a redelivery is a no-op:
 *
 * - if the projection is absent or already `succeeded`/`dead_lettered`, the event
 *   is not re-run — `markPublished` is stamped so a replay stops seeing it;
 * - otherwise `markRunning(attempt)` → handler → `markSucceeded` + outbox
 *   `markPublished` + a consumption audit fact;
 * - on throw, outbox `recordAttempt`, `markJobFailed` (which dead-letters at the
 *   `maxAttempts` threshold), outbox `deadLetter` when terminal, then rethrow so
 *   pg-boss applies its own retry/backoff.
 */
export function createOutboxConsumer(
  options: OutboxConsumerOptions,
): WorkHandler<OutboxJobPayload> {
  const { store, handlers, db, logger } = options;

  return async (jobs: Job<OutboxJobPayload>[]): Promise<void> => {
    for (const job of jobs) {
      await consumeOne(store, handlers, db, logger, job);
    }
  };
}

async function consumeOne(
  store: JobStore,
  handlers: OutboxHandlerRegistry,
  db: Database | undefined,
  logger: RuntimeLogger | undefined,
  job: Job<OutboxJobPayload>,
): Promise<void> {
  const payload = job.data;
  const { organizationId, id: outboxEventId, eventType } = payload;

  const projection = await store.findJobByOutboxEventId(organizationId, outboxEventId);
  if (projection === undefined || SETTLED_STATUSES.has(projection.status)) {
    // Stamping published_at on a dead_lettered projection too: the replay maintenance
    // job selects `published_at IS NULL`, so a dead-lettered event must not be re-picked;
    // it stays reviewable through `dead_lettered_at`.
    await store.markPublished(outboxEventId);
    logger?.debug({ outboxEventId, eventType }, "outbox event already settled; skipped");
    return;
  }

  const handler = handlers[eventType];

  const attempt = projection.attempts + 1;
  await markJobRunning(store, projection.id, attempt, { organizationId });

  try {
    if (handler === undefined) {
      throw new Error(`no outbox handler registered for event type "${eventType}"`);
    }
    await handler({
      organizationId,
      outboxEventId,
      eventType,
      payload,
      store,
      ...(db === undefined ? {} : { db }),
      ...(logger === undefined ? {} : { logger }),
    });
    await markJobSucceeded(store, projection.id, { organizationId });
    await store.markPublished(outboxEventId);
    await store.writeAudit({
      organizationId,
      actorId: null,
      action: JOB_AUDIT_ACTIONS.jobConsumed,
      entityType: JOB_ENTITY_TYPE,
      entityId: projection.id,
      after: { outbox_event_id: outboxEventId, event_type: eventType, attempt },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.recordAttempt(outboxEventId);
    const failed = await markJobFailed(store, projection.id, message, {
      deadLetter: false,
      organizationId,
    });
    if (failed.status === "dead_lettered") {
      await store.deadLetter(outboxEventId);
    }
    logger?.error({ err: error, outboxEventId, eventType }, "outbox event consumption failed");
    throw error;
  }
}
