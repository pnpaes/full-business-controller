/**
 * Audit action vocabulary for the row-12 sales + settlements + reconciliation
 * slice (`SALE-003`/`SALE-005`, `REC-001`/`002`/`005`). Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names.
 */
export const SALES_AUDIT_ACTIONS = {
  importRunPosted: "sales.import_run.posted",
  importRunReconciled: "sales.import_run.reconciled",
  settlementReconciled: "sales.settlement.reconciled",
  reconciliationResolved: "sales.reconciliation.resolved",
  consumptionPosted: "sales.consumption.posted",
  salesLineReversed: "sales.sales_line.reversed",
} as const;
