import { isBlank } from "../inventory/validation";

import { TRANSFER_AUDIT_ACTIONS } from "./actions";
import { assertTransferStatus, loadStockTransfer } from "./state";
import type { TransferStore } from "./types";

export interface CancelStockTransferInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly transferId: string;
  readonly reasonCode?: string | null;
}

export interface CancelStockTransferResult {
  readonly transferId: string;
}

/**
 * Cancels a transfer that has not moved stock: `draft`/`requested`/`approved` →
 * `cancelled`. A dispatched transfer cannot be cancelled — the goods have left
 * the source, so the correction is a receipt (possibly partial) or a later
 * reversal, never a status flip (`DEC-028`, `DEC-029`).
 */
export async function cancelStockTransfer(
  store: TransferStore,
  input: CancelStockTransferInput,
): Promise<CancelStockTransferResult> {
  return store.withTransaction(async (tx) => {
    const transfer = await loadStockTransfer(tx, input.organizationId, input.transferId);
    assertTransferStatus(transfer, ["draft", "requested", "approved"], "cancel");

    await tx.updateStockTransfer({
      organizationId: input.organizationId,
      transferId: transfer.id,
      values: { status: "cancelled" },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TRANSFER_AUDIT_ACTIONS.cancelled,
      entityType: "stock_transfer",
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: "cancelled" },
      ...(isBlank(input.reasonCode) ? {} : { reason: input.reasonCode!.trim() }),
    });

    return { transferId: transfer.id };
  });
}
