import { TRANSFER_AUDIT_ACTIONS } from "./actions";
import { assertTransferStatus, loadStockTransfer } from "./state";
import type { TransferStore } from "./types";

export interface ApproveStockTransferInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly transferId: string;
}

export interface ApproveStockTransferResult {
  readonly transferId: string;
}

/** `requested` → `approved` (`DEC-029`). The dispatch command requires `approved`. */
export async function approveStockTransfer(
  store: TransferStore,
  input: ApproveStockTransferInput,
): Promise<ApproveStockTransferResult> {
  return store.withTransaction(async (tx) => {
    const transfer = await loadStockTransfer(tx, input.organizationId, input.transferId);
    assertTransferStatus(transfer, ["requested"], "approve");

    await tx.updateStockTransfer({
      organizationId: input.organizationId,
      transferId: transfer.id,
      values: { status: "approved" },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TRANSFER_AUDIT_ACTIONS.approved,
      entityType: "stock_transfer",
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: "approved" },
    });

    return { transferId: transfer.id };
  });
}
