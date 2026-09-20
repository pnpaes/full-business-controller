import { DomainError } from "@aquarela/domain";

import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import type { ProductionStore } from "./types";

export interface ReleaseProductionBatchInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productionBatchId: string;
}

export interface ReleaseProductionBatchResult {
  readonly status: string;
}

/**
 * Releases a planned batch (`PROD-001`) into the production queue: `planned →
 * released`. Only a planned batch can be released; releasing a running or
 * completed batch is rejected rather than silently accepted. The transition and
 * its audit fact commit together.
 */
export async function releaseProductionBatch(
  store: ProductionStore,
  input: ReleaseProductionBatchInput,
): Promise<ReleaseProductionBatchResult> {
  return store.withTransaction(async (tx) => {
    const batch = await tx.findProductionBatch({
      organizationId: input.organizationId,
      productionBatchId: input.productionBatchId,
    });
    if (batch === undefined) {
      throw new DomainError("production batch not found in organization");
    }
    if (batch.status !== "planned") {
      throw new DomainError(`a batch can only be released from planned (current: ${batch.status})`);
    }

    const updated = await tx.updateProductionBatch(batch.id, { status: "released" });
    if (updated === undefined) {
      throw new DomainError("production batch not found for update");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.batchReleased,
      entityType: "production_batch",
      entityId: batch.id,
      after: { from_status: batch.status, status: updated.status },
    });

    return { status: updated.status };
  });
}
