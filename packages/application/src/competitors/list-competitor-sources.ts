import type { CompetitorSourceRecord, CompetitorStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_COMPETITOR_SOURCE_LIMIT = 100;

export interface ListCompetitorSourcesQuery {
  readonly organizationId: string;
  /** `true` → open-ended (`active_to is null`); `false` → ended. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The competitor-source register for one organization, competitor-name then URL
 * ascending (`ADR-0010`/`DEC-143`). The organization filter is never optional
 * (`DEC-061`); `active` optionally narrows to the open-ended (`true`) or ended
 * (`false`) sources; `limit` defaults to `DEFAULT_COMPETITOR_SOURCE_LIMIT`.
 */
export async function listCompetitorSources(
  store: CompetitorStore,
  query: ListCompetitorSourcesQuery,
): Promise<readonly CompetitorSourceRecord[]> {
  return store.listCompetitorSources({
    organizationId: query.organizationId,
    ...(query.active === undefined ? {} : { active: query.active }),
    limit: query.limit ?? DEFAULT_COMPETITOR_SOURCE_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
