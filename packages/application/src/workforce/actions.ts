/**
 * Audit action vocabulary for the workforce personnel slice (`DEC-087`,
 * `WF-007`, `DOC-001`…`DOC-004`). Values are the `audit_event.action` strings;
 * keeping them here stops a handler from drifting into near-duplicate names.
 *
 * `employee` is retired, never deleted (`03.10`), so retirement records its own
 * action rather than overloading `updated`. Personnel documents have **no
 * version model** (`DEC-087` defines none), so they use only `created`/`updated`.
 */
export const WORKFORCE_AUDIT_ACTIONS = {
  employeeCreated: "workforce.employee.created",
  employeeUpdated: "workforce.employee.updated",
  employeeRetired: "workforce.employee.retired",
  employeeDocumentCreated: "workforce.employee_document.created",
  employeeDocumentUpdated: "workforce.employee_document.updated",
  positionCreated: "workforce.position.created",
  positionUpdated: "workforce.position.updated",
} as const;
