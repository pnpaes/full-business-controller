/**
 * Audit action vocabulary for the import framework slice (`SALE-002`,
 * `SALE-004`, `SALE-007`). Values are the `audit_event.action` strings; keeping
 * them here stops a handler from drifting into near-duplicate names.
 *
 * Slice 11 records the run lifecycle only; posting/reconciliation actions
 * belong to slice 12.
 */
export const IMPORTS_AUDIT_ACTIONS = {
  runCreated: "sales.import_run.created",
  rowsStaged: "sales.import_run.rows_staged",
  runValidated: "sales.import_run.validated",
  rowsMapped: "sales.import_run.rows_mapped",
  rowDispositioned: "sales.import_run.row_dispositioned",
} as const;
