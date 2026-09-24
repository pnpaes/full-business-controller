import type { CompetitorRecord, CompetitorStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_COMPETITOR_LIMIT = 100;

export interface ListCompetitorsQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The competitor register for one organization, name-ascending (`DEC-126`). The
 * organization filter is never optional (`DEC-061`), and `limit` defaults to
 * `DEFAULT_COMPETITOR_LIMIT` so a caller cannot ask for the whole register
 * unbounded.
 */
export async function listCompetitors(
  store: CompetitorStore,
  query: ListCompetitorsQuery,
): Promise<readonly CompetitorRecord[]> {
  return store.listCompetitors({
    organizationId: query.organizationId,
    limit: query.limit ?? DEFAULT_COMPETITOR_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
