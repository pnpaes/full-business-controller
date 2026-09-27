/**
 * Audit action vocabulary and entity types for the jobs/outbox platform core
 * (`ADR-0004`). Values are the `audit_event.action` strings; keeping them here
 * stops a handler from drifting into near-duplicate names.
 */
export const JOB_AUDIT_ACTIONS = {
  outboxEventEnqueued: "jobs.outbox_event.enqueued",
  jobRunning: "jobs.job.running",
  jobSucceeded: "jobs.job.succeeded",
  jobFailed: "jobs.job.failed",
  jobDeadLettered: "jobs.job.dead_lettered",
  /** Operator DLQ review: a dead-lettered job was reset to pending for a fresh delivery. */
  jobRetried: "jobs.job.retried",
  /** Operator DLQ review: a dead-lettered job was discarded into terminal `failed`. */
  jobDiscarded: "jobs.job.discarded",
  jobConsumed: "jobs.job.consumed",
} as const;

/** The enqueue audit targets the outbox event (the durable fact). */
export const OUTBOX_EVENT_ENTITY_TYPE = "outbox_event";

/** The status-transition audits target the job projection. */
export const JOB_ENTITY_TYPE = "job";
