/**
 * Audit action vocabulary for the waste vertical (`WASTE-001`). Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names.
 */
export const WASTE_AUDIT_ACTIONS = {
  wasteEventRecorded: "waste.event.recorded",
} as const;
