import type { PositionRecord, WorkforceStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_POSITION_LIMIT = 200;

export interface ListPositionsQuery {
  readonly organizationId: string;
  /** `true` = active now; `false` = expired; omitted = all. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The position catalogue for one organization (`DEC-151`), ordered by name then
 * id, with an optional active filter and bounded paging. The read is always
 * organization-scoped (`DEC-061`).
 */
export async function listPositions(
  store: WorkforceStore,
  query: ListPositionsQuery,
): Promise<readonly PositionRecord[]> {
  return store.listPositions({
    organizationId: query.organizationId,
    ...(query.active === undefined ? {} : { active: query.active }),
    limit: query.limit ?? DEFAULT_POSITION_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
