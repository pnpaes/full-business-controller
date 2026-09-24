import { DomainError, type UnitDimension } from "@aquarela/domain";

import type { MasterDataStore, MasterUnit } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_UNIT_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_UNIT_LIMIT = 200;

export interface ListUnitsQuery {
  readonly organizationId: string;
  readonly dimension?: UnitDimension;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Units of measure for one organization (FND-003), ordered by `code` (then
 * `id`), with an optional dimension filter. The organization filter is never
 * optional, so a caller cannot read another tenant's units (`DEC-061`); `limit`
 * defaults to `DEFAULT_UNIT_LIMIT` and is validated against `MAX_UNIT_LIMIT` so
 * a caller cannot request the whole register unbounded.
 */
export async function listUnits(
  store: MasterDataStore,
  query: ListUnitsQuery,
): Promise<readonly MasterUnit[]> {
  const limit = query.limit ?? DEFAULT_UNIT_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_UNIT_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_UNIT_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  return store.listUnits({
    organizationId: query.organizationId,
    ...(query.dimension === undefined ? {} : { dimension: query.dimension }),
    limit,
    offset,
  });
}
