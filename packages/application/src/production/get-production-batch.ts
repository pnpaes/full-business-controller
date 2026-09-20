import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";
import type {
  ProductionBatchInputRecord,
  ProductionBatchOutputRecord,
  ProductionBatchRecord,
  ProductionStore,
} from "./types";

export interface GetProductionBatchQuery {
  readonly organizationId: string;
  readonly productionBatchId: string;
}

export interface ProductionBatchDetail {
  readonly batch: ProductionBatchRecord;
  readonly inputs: readonly ProductionBatchInputRecord[];
  readonly outputs: readonly ProductionBatchOutputRecord[];
}

/**
 * One batch with its input/output lines, organization-scoped (`DEC-061`), or
 * `undefined` (the read API maps that to 404). Lines are empty until the batch
 * completes: the planned+actual rows are written by `completeProductionBatch`
 * (open point (i) — the persistence surface has no batch-line update).
 */
export async function getProductionBatch(
  store: ProductionStore,
  query: GetProductionBatchQuery,
): Promise<ProductionBatchDetail | undefined> {
  if (isBlank(query.productionBatchId)) {
    throw new DomainError("productionBatchId is required");
  }
  const productionBatchId = query.productionBatchId.trim();
  const batch = await store.findProductionBatch({
    organizationId: query.organizationId,
    productionBatchId,
  });
  if (batch === undefined) {
    return undefined;
  }
  const [inputs, outputs] = await Promise.all([
    store.listProductionBatchInputs({ organizationId: query.organizationId, productionBatchId }),
    store.listProductionBatchOutputs({ organizationId: query.organizationId, productionBatchId }),
  ]);
  return { batch, inputs, outputs };
}
