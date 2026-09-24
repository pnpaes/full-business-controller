/**
 * Audit action vocabulary for the task slice (`DEC-122`). Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names (the documents/HMS convention).
 *
 * A task is mutated, not append-only, so each lifecycle write records its own
 * action (`created`, `transitioned`, `assigned`) rather than overloading
 * `updated`.
 */
export const TASK_AUDIT_ACTIONS = {
  taskCreated: "workflow.task.created",
  taskTransitioned: "workflow.task.transitioned",
  taskAssigned: "workflow.task.assigned",
} as const;
