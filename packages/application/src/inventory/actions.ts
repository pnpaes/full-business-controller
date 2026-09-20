/**
 * Audit action vocabulary for the stock ledger + balances + lots/storage slice.
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names.
 */
export const INVENTORY_AUDIT_ACTIONS = {
  stockMovementPosted: "inventory.stock_movement.posted",
  stockMovementReversed: "inventory.stock_movement.reversed",
  revaluationPosted: "inventory.stock_balance.revaluation_posted",
  storageAreaRegistered: "inventory.storage_area.registered",
} as const;
