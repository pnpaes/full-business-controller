import { DomainError } from "@aquarela/domain";

import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import type { ProductionStore } from "./types";

export interface CancelProductionBatchInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productionBatchId: string;
  /** Optional reason, recorded in the audit fact. */
  readonly reason?: string;
}

export interface CancelProductionBatchResult {
  readonly status: string;
}

/**
 * Cancels a batch that has not completed: `planned`/`released`/`in_progress →
 * cancelled`. A completed batch cannot be cancelled — its consumption/output
 * movements are already in the append-only ledger, so undoing them is a
 * `DEC-028` reversal, not a status change (mirrors `cancelStockCount`). Nothing
 * is posted before completion, so cancelling a running batch is safe.
 */
export async function cancelProductionBatch(
  store: ProductionStore,
  input: CancelProductionBatchInput,
): Promise<CancelProductionBatchResult> {
  return store.withTransaction(async (tx) => {
    const batch = await tx.findProductionBatch({
      organizationId: input.organizationId,
      productionBatchId: input.productionBatchId,
    });
    if (batch === undefined) {
      throw new DomainError("production batch not found in organization");
    }
    if (batch.status === "completed") {
      throw new DomainError(
        "a completed batch cannot be cancelled; reverse its movements instead (DEC-028)",
      );
    }
    if (batch.status === "cancelled") {
      throw new DomainError("batch already cancelled");
    }

    const updated = await tx.updateProductionBatch(batch.id, { status: "cancelled" });
    if (updated === undefined) {
      throw new DomainError("production batch not found for update");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.batchCancelled,
      entityType: "production_batch",
      entityId: batch.id,
      after: { from_status: batch.status, status: updated.status },
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });

    return { status: updated.status };
  });
}
