/**
 * Audit action vocabulary for the production slice (`PROD-001`–`005`). Values
 * are the `audit_event.action` strings; keeping them here stops a handler from
 * drifting into near-duplicate names.
 */
export const PRODUCTION_AUDIT_ACTIONS = {
  planCreated: "production.plan.created",
  batchCreated: "production.batch.created",
  batchReleased: "production.batch.released",
  batchStarted: "production.batch.started",
  batchCompleted: "production.batch.completed",
  batchCancelled: "production.batch.cancelled",
} as const;
