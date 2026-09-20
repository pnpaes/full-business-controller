/**
 * Audit action vocabulary for the transfers vertical (`INV-005`, `DEC-029`).
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names.
 */
export const TRANSFER_AUDIT_ACTIONS = {
  requested: "inventory.transfer.requested",
  approved: "inventory.transfer.approved",
  dispatched: "inventory.transfer.dispatched",
  received: "inventory.transfer.received",
  cancelled: "inventory.transfer.cancelled",
} as const;
