/**
 * Audit action vocabulary for the shift-scheduling slice (`WF-002`, `WF-003`,
 * `DEC-037`, `DEC-038`). Values are the `audit_event.action` strings; keeping
 * them here stops a handler from drifting into near-duplicate names.
 *
 * Shifts are mutated, not append-only, so the lifecycle transitions
 * (`published`, `cancelled`, `completed`) each record their own action rather
 * than overloading `updated`; an assignment is a separate fact with its own
 * `created`/`withdrawn` pair. A worked-hours correction (`WF-004`) is another
 * append-only fact with its own `created` action. The monthly payroll-input
 * report (`WF-005`) records its own `generated`/`exported` actions and a
 * `superseded` action when a same-period regeneration replaces a prior report.
 */
export const SCHEDULING_AUDIT_ACTIONS = {
  shiftCreated: "workforce.shift.created",
  shiftUpdated: "workforce.shift.updated",
  shiftPublished: "workforce.shift.published",
  shiftCancelled: "workforce.shift.cancelled",
  shiftCompleted: "workforce.shift.completed",
  shiftAssignmentCreated: "workforce.shift_assignment.created",
  shiftAssignmentWithdrawn: "workforce.shift_assignment.withdrawn",
  shiftAdjustmentCreated: "workforce.shift_adjustment.created",
  payrollReportGenerated: "workforce.payroll_report.generated",
  payrollReportExported: "workforce.payroll_report.exported",
  payrollReportSuperseded: "workforce.payroll_report.superseded",
} as const;
