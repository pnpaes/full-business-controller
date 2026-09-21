/**
 * Audit action vocabulary for the HMS monitoring slice (`HMS-002`, `DEC-089`)
 * and the incidents + corrective-actions slice (`DEC-090`, `HMS-003`/`HMS-004`).
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names.
 *
 * A patch that makes the `closed`/`completed`/`verified` transition records the
 * specific action; any other amendment records the generic `updated` one.
 */
export const HMS_AUDIT_ACTIONS = {
  monitoringPointCreated: "hms.monitoring_point.created",
  monitoringPointUpdated: "hms.monitoring_point.updated",
  monitoringReadingRecorded: "hms.monitoring_reading.recorded",
  incidentCreated: "hms.incident.created",
  incidentUpdated: "hms.incident.updated",
  incidentClosed: "hms.incident.closed",
  correctiveActionCreated: "hms.corrective_action.created",
  correctiveActionUpdated: "hms.corrective_action.updated",
  correctiveActionCompleted: "hms.corrective_action.completed",
  correctiveActionVerified: "hms.corrective_action.verified",
} as const;
