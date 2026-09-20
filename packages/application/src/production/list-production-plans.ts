import { DomainError } from "@aquarela/domain";

import type { ProductionPlanRecord, ProductionStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_PRODUCTION_PLAN_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the plan log for an unbounded page. */
export const MAX_PRODUCTION_PLAN_LIMIT = 200;

export interface ListProductionPlansQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ProductionPlanPage {
  readonly plans: readonly ProductionPlanRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Production plans for one organization (`PROD-001`), newest production date
 * first, with optional location/status filters. The read is bounded: `limit`
 * defaults and is capped, `hasMore` is derived by fetching one row past the page,
 * and an invalid `limit`/`offset` is rejected before the store is touched.
 */
export async function listProductionPlans(
  store: ProductionStore,
  query: ListProductionPlansQuery,
): Promise<ProductionPlanPage> {
  const limit = query.limit ?? DEFAULT_PRODUCTION_PLAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PRODUCTION_PLAN_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_PRODUCTION_PLAN_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listProductionPlans({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    limit: limit + 1,
    offset,
  });

  const hasMore = rows.length > limit;
  return {
    plans: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
