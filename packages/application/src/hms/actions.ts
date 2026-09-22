/**
 * Audit action vocabulary for the HMS monitoring slice (`HMS-002`, `DEC-089`),
 * the incidents + corrective-actions slice (`DEC-090`, `HMS-003`/`HMS-004`),
 * the checklists slice (`DEC-091`, `HMS-005`), the equipment/maintenance
 * slice (`DEC-092`, `HMS-006`) and the compliance/evidence export
 * (`DEC-093`/`DEC-098`, `HMS-007`). Values are the `audit_event.action` strings;
 * keeping them here stops a handler from drifting into near-duplicate names.
 *
 * A patch that makes the `closed`/`completed`/`verified` transition records the
 * specific action; any other amendment records the generic `updated` one. The
 * checklist and equipment/maintenance tables have no derived transition
 * (`DEC-092`/`DEC-096`), so they only use `created`/`updated`/`recorded`.
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
  checklistTemplateCreated: "hms.checklist_template.created",
  checklistTemplateUpdated: "hms.checklist_template.updated",
  checklistRunRecorded: "hms.checklist_run.recorded",
  checklistRunUpdated: "hms.checklist_run.updated",
  equipmentCreated: "hms.equipment.created",
  equipmentUpdated: "hms.equipment.updated",
  maintenanceLogRecorded: "hms.maintenance_log.recorded",
  complianceExportGenerated: "hms.compliance_export.generated",
} as const;
