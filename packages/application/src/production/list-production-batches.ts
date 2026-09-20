import { DomainError } from "@aquarela/domain";

import type { ProductionBatchRecord, ProductionStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_PRODUCTION_BATCH_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the batch log for an unbounded page. */
export const MAX_PRODUCTION_BATCH_LIMIT = 200;

export interface ListProductionBatchesQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly planId?: string;
  readonly workstation?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ProductionBatchPage {
  readonly batches: readonly ProductionBatchRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Production batches for one organization (`PROD-001`), newest first, with
 * optional location/status/plan/workstation filters. The read is bounded:
 * `limit` defaults and is capped, `hasMore` is derived by fetching one row past
 * the page, and an invalid `limit`/`offset` is rejected before the store.
 */
export async function listProductionBatches(
  store: ProductionStore,
  query: ListProductionBatchesQuery,
): Promise<ProductionBatchPage> {
  const limit = query.limit ?? DEFAULT_PRODUCTION_BATCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PRODUCTION_BATCH_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_PRODUCTION_BATCH_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listProductionBatches({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.planId === undefined ? {} : { planId: query.planId }),
    ...(query.workstation === undefined ? {} : { workstation: query.workstation }),
    limit: limit + 1,
    offset,
  });

  const hasMore = rows.length > limit;
  return {
    batches: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
