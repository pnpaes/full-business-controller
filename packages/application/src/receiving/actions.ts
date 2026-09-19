/**
 * Audit action vocabulary for receiving. Values are the `audit_event.action`
 * strings; keeping them here stops a handler from drifting into near-duplicate
 * names.
 */
export const RECEIVING_AUDIT_ACTIONS = {
  receiptRecorded: "receiving.goods_receipt.recorded",
} as const;

export type ReceivingAuditAction =
  (typeof RECEIVING_AUDIT_ACTIONS)[keyof typeof RECEIVING_AUDIT_ACTIONS];
