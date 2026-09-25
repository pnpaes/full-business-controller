import { DomainError } from "@aquarela/domain";

import type { CostingReadStore } from "./read-types";
import type { CostCenterRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_COST_CENTER_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_COST_CENTER_LIMIT = 200;

export interface ListCostCentersQuery {
  readonly organizationId: string;
  /** Absent = every kind; present = that `cost_center_kind` only. */
  readonly kind?: string;
  /** Absent = every location; present = that location only (null location stays excluded). */
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's cost centres (`DATA_DICTIONARY` §1), ordered by `code` (then
 * `id`), with optional kind/location filters. The organization filter is never
 * optional, so a caller cannot read another tenant's centres (`DEC-061`); `limit`
 * defaults to `DEFAULT_COST_CENTER_LIMIT` and is validated against
 * `MAX_COST_CENTER_LIMIT` so a caller cannot request the whole register
 * unbounded. Cross-organization rows are dropped as defence in depth on top of
 * the store's own filter.
 */
export async function listCostCenters(
  store: CostingReadStore,
  query: ListCostCentersQuery,
): Promise<readonly CostCenterRecord[]> {
  const limit = query.limit ?? DEFAULT_COST_CENTER_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COST_CENTER_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_COST_CENTER_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listCostCenters({
    organizationId: query.organizationId,
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    limit,
    offset,
  });
  return rows.filter((center) => center.organizationId === query.organizationId);
}
