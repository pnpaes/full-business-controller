/**
 * Audit action vocabulary for the row-12 sales + settlements + reconciliation
 * slice. Values are the `audit_event.action` strings; the reconciliation
 * actions live here beside the domain they record.
 */
export const RECONCILIATION_AUDIT_ACTIONS = {
  importRunReconciled: "sales.import_run.reconciled",
  settlementReconciled: "sales.settlement.reconciled",
  reconciliationResolved: "sales.reconciliation.resolved",
} as const;
