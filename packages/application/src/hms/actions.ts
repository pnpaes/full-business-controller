/**
 * Audit action vocabulary for the HMS monitoring slice (`HMS-002`, `DEC-089`).
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names.
 */
export const HMS_AUDIT_ACTIONS = {
  monitoringPointCreated: "hms.monitoring_point.created",
  monitoringPointUpdated: "hms.monitoring_point.updated",
  monitoringReadingRecorded: "hms.monitoring_reading.recorded",
} as const;
