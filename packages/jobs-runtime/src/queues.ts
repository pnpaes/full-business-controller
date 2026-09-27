import type { QueueOptions, UpdateQueueOptions } from "pg-boss";

import type { BossQueueApi } from "./boss";

/**
 * One pg-boss queue per event type (`enqueueOutboxEvent` defaults the application
 * queue name to the event type, so the runner mirrors that: `eventType` →
 * `outbox.<eventType>`). The durable dedup key stays `outbox_event.id`, which the
 * dispatcher uses as the queue job id — a replay of the same row is a pg-boss
 * `ON CONFLICT DO NOTHING` and resolves `null`, so replay is safe.
 */
export const OUTBOX_DEAD_LETTER_QUEUE = "outbox-dead-letter";
export const MAINTENANCE_QUEUE = "outbox.maintenance.replay";
// The monitor queue name lives here with the other queue-name constants so
// `queueOptionsFor` can classify it without importing `./monitor` (which imports
// this module); `./monitor` re-exports it.
export const MONITOR_QUEUE = "outbox.maintenance.monitor";

/**
 * The scheduled producer's cron queue (`DEC-139` first real producer): the
 * scheduler registers a cron that enqueues the payroll-report generation event
 * onto {@link PAYROLL_REPORT_GENERATE_EVENT_TYPE}'s outbox queue. The cron queue
 * itself carries no business payload beyond the organization id.
 */
export const PAYROLL_SCHEDULE_QUEUE = "outbox.maintenance.payroll_report";

/** The outbox event type the payroll schedule enqueues (consumed by the worker). */
export const PAYROLL_REPORT_GENERATE_EVENT_TYPE = "workforce.payroll_report.generate";

/**
 * The scheduled AI-advisory cron queue (`ADR-0009`, `DEC-142`). The scheduler
 * registers a weekly cron that runs the advisory directly (no outbox event —
 * there is nothing to consume downstream); the cron queue carries only the
 * organization id. The kill switch lives in the handler.
 */
export const AI_ADVISORY_QUEUE = "outbox.maintenance.ai_advisory";

/**
 * The scheduled competitor-collection cron queue (`ADR-0010`, `DEC-143`/`DEC-149`,
 * row 18b). The scheduler registers a weekly cron that fetches the approved
 * automated sources directly (no outbox event — there is nothing to consume
 * downstream); the cron queue carries only the organization id. The kill switch
 * lives in the handler.
 */
export const COMPETITOR_COLLECTION_QUEUE = "outbox.maintenance.competitor_collection";

export function outboxQueueName(eventType: string): string {
  return `outbox.${eventType}`;
}

/** The job payload the runner carries: just the routing metadata for the row. */
export interface OutboxJobPayload {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

export function outboxJobPayload(event: OutboxJobPayload): OutboxJobPayload {
  return {
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
  };
}

/** Queue options plus the queue-level dead-letter target. */
export type OutboxQueueOptions = QueueOptions & { readonly deadLetter?: string };

/**
 * `DEC-139` retry policy: exponential backoff capped at one hour, five retries,
 * then pg-boss routes the copy to the dead-letter queue (belt-and-braces with the
 * application-level `job.max_attempts` dead-letter). Expiry bounds a hung
 * delivery; completed jobs are pruned after a week.
 */
export const OUTBOX_QUEUE_OPTIONS: OutboxQueueOptions = {
  expireInSeconds: 300,
  retentionSeconds: 1209600,
  deleteAfterSeconds: 604800,
  // retryLimit: 5 is 5 retries on top of the initial delivery, so pg-boss runs up
  // to 6 deliveries. The `job` projection's `maxAttempts` is 5, so the 6th
  // delivery finds the projection settled and is an idempotent settled-skip no-op.
  retryLimit: 5,
  retryBackoff: true,
  retryDelay: 1,
  retryDelayMax: 3600,
  deadLetter: OUTBOX_DEAD_LETTER_QUEUE,
};

/** Dead-letters are kept 30 days (`DEC-139`) and never retried by the runner. */
export const DEAD_LETTER_QUEUE_OPTIONS: OutboxQueueOptions = {
  expireInSeconds: 300,
  retentionSeconds: 2592000,
  deleteAfterSeconds: 2592000,
  retryLimit: 0,
};

/** The maintenance replay is idempotent and cheap; it barely needs retries. */
export const MAINTENANCE_QUEUE_OPTIONS: OutboxQueueOptions = {
  expireInSeconds: 300,
  retentionSeconds: 604800,
  deleteAfterSeconds: 86400,
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 3600,
};

export function queueOptionsFor(name: string): OutboxQueueOptions {
  if (name === OUTBOX_DEAD_LETTER_QUEUE) {
    return DEAD_LETTER_QUEUE_OPTIONS;
  }
  if (
    name === MAINTENANCE_QUEUE ||
    name === PAYROLL_SCHEDULE_QUEUE ||
    name === MONITOR_QUEUE ||
    name === AI_ADVISORY_QUEUE ||
    name === COMPETITOR_COLLECTION_QUEUE
  ) {
    // The payroll, monitor, AI-advisory and competitor-collection crons are
    // maintenance-grade jobs: a cron re-run is cheap and idempotent, so they share
    // the maintenance retry policy rather than the outbox delivery policy (and
    // never dead-letter to the outbox DLQ, which would otherwise trip the
    // monitor's own dead-letter alert).
    return MAINTENANCE_QUEUE_OPTIONS;
  }
  return OUTBOX_QUEUE_OPTIONS;
}

/**
 * `updateQueue` in pg-boss 12.33.2 cannot change `retryDelayMax` or
 * `heartbeatSeconds` (they are omitted from `UpdateQueueOptions`), so those are
 * set at creation and only the updatable fields are re-applied here.
 */
function toUpdateOptions(options: OutboxQueueOptions): UpdateQueueOptions {
  const update: UpdateQueueOptions = {};
  if (options.expireInSeconds !== undefined) update.expireInSeconds = options.expireInSeconds;
  if (options.retentionSeconds !== undefined) update.retentionSeconds = options.retentionSeconds;
  if (options.deleteAfterSeconds !== undefined)
    update.deleteAfterSeconds = options.deleteAfterSeconds;
  if (options.retryLimit !== undefined) update.retryLimit = options.retryLimit;
  if (options.retryBackoff !== undefined) update.retryBackoff = options.retryBackoff;
  if (options.retryDelay !== undefined) update.retryDelay = options.retryDelay;
  if (options.deadLetter !== undefined) update.deadLetter = options.deadLetter;
  return update;
}

/**
 * Idempotently create-or-update the queues the runtime uses. The dead-letter
 * queue is created first: a queue that names a `deadLetter` requires its target
 * to already exist (`pg-boss` `createQueue` resolves it through the queue cache).
 */
export async function ensureQueues(boss: BossQueueApi, names: readonly string[]): Promise<void> {
  await boss.createQueue(OUTBOX_DEAD_LETTER_QUEUE, DEAD_LETTER_QUEUE_OPTIONS);
  await boss.updateQueue(OUTBOX_DEAD_LETTER_QUEUE, toUpdateOptions(DEAD_LETTER_QUEUE_OPTIONS));

  const unique = [...new Set(names)].filter((name) => name !== OUTBOX_DEAD_LETTER_QUEUE);
  for (const name of unique) {
    const options = queueOptionsFor(name);
    await boss.createQueue(name, options);
    await boss.updateQueue(name, toUpdateOptions(options));
  }
}
