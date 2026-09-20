import { DomainError } from "@aquarela/domain";

import type { StockTransferRecord, TransferStore } from "./types";

/**
 * Loads one transfer inside a transaction, org-scoped, and fails with a clear
 * `DomainError` when it is unknown or belongs to another organization. Every
 * state transition starts here, so the guard and the error text stay uniform.
 */
export async function loadStockTransfer(
  store: TransferStore,
  organizationId: string,
  transferId: string,
): Promise<StockTransferRecord> {
  const transfer = await store.findStockTransfer({ organizationId, transferId });
  if (transfer === undefined) {
    throw new DomainError("transfer not found in organization");
  }
  return transfer;
}

/** The transfer workflow state machine, one guard for every transition. */
export function assertTransferStatus(
  transfer: StockTransferRecord,
  allowed: readonly string[],
  verb: string,
): void {
  if (!allowed.includes(transfer.status)) {
    throw new DomainError(`cannot ${verb} a transfer in status ${transfer.status}`);
  }
}
