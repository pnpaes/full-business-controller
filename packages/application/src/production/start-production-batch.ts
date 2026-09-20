import { DomainError } from "@aquarela/domain";

import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import type { ProductionStore } from "./types";

export interface StartProductionBatchInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productionBatchId: string;
  /** ISO instant; defaults to now. */
  readonly actualStart?: string;
}

export interface StartProductionBatchResult {
  readonly status: string;
  /** `timestamptz`, ISO. */
  readonly actualStart: string | null;
}

/**
 * Starts a released batch: `released → in_progress`, stamping `actual_start`.
 * Only a released batch can be started; starting a planned batch is rejected so
 * the release step cannot be skipped silently. The transition and its audit fact
 * commit together.
 */
export async function startProductionBatch(
  store: ProductionStore,
  input: StartProductionBatchInput,
): Promise<StartProductionBatchResult> {
  return store.withTransaction(async (tx) => {
    const batch = await tx.findProductionBatch({
      organizationId: input.organizationId,
      productionBatchId: input.productionBatchId,
    });
    if (batch === undefined) {
      throw new DomainError("production batch not found in organization");
    }
    if (batch.status !== "released") {
      throw new DomainError(`a batch can only be started from released (current: ${batch.status})`);
    }

    const actualStart = input.actualStart ?? new Date().toISOString();
    const updated = await tx.updateProductionBatch(batch.id, {
      status: "in_progress",
      actualStart,
    });
    if (updated === undefined) {
      throw new DomainError("production batch not found for update");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.batchStarted,
      entityType: "production_batch",
      entityId: batch.id,
      after: { from_status: batch.status, status: updated.status, actual_start: actualStart },
    });

    return { status: updated.status, actualStart: updated.actualStart };
  });
}
