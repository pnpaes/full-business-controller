import { DomainError } from "@aquarela/domain";

import { COUNTS_AUDIT_ACTIONS } from "./actions";
import type { CountStore } from "./types";

export interface CancelStockCountInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly stockCountId: string;
}

export interface CancelStockCountResult {
  readonly status: string;
}

/**
 * Cancels an open count (`INV-004`). An approved count cannot be cancelled: its
 * variances are already in the append-only ledger, so undoing them is a
 * `DEC-028` reversal, not a status change. A cancelled count keeps its lines for
 * the audit trail but can no longer be counted or approved.
 */
export async function cancelStockCount(
  store: CountStore,
  input: CancelStockCountInput,
): Promise<CancelStockCountResult> {
  return store.withTransaction(async (tx) => {
    const count = await tx.findStockCount({
      organizationId: input.organizationId,
      stockCountId: input.stockCountId,
    });
    if (count === undefined) {
      throw new DomainError("stock count not found in organization");
    }
    if (count.status === "approved") {
      throw new DomainError("an approved count cannot be cancelled; reverse its movements instead");
    }
    if (count.status === "cancelled") {
      throw new DomainError("count already cancelled");
    }

    const updated = await tx.updateStockCount(count.id, { status: "cancelled" });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COUNTS_AUDIT_ACTIONS.countCancelled,
      entityType: "stock_count",
      entityId: count.id,
      after: { from_status: count.status, status: updated.status },
    });

    return { status: updated.status };
  });
}
