/**
 * Audit action vocabulary for the counts slice (`INV-004`). Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names.
 */
export const COUNTS_AUDIT_ACTIONS = {
  countOpened: "inventory.stock_count.opened",
  linesRecorded: "inventory.stock_count.lines_recorded",
  countApproved: "inventory.stock_count.approved",
  countCancelled: "inventory.stock_count.cancelled",
} as const;
