import { DomainError } from "@aquarela/domain";

import type { ListIntegrationSourcesQuery } from "./read-types";
import type { IntegrationSourceReadStore, IntegrationSourceRecord } from "./read-types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_INTEGRATION_SOURCE_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole registry in one page. */
export const MAX_INTEGRATION_SOURCE_LIMIT = 200;

/**
 * The organization's integration sources (`INTG-001`, `DEC-137`), ordered by
 * `name` (then `id`). The organization filter is never optional, so a caller
 * cannot read another tenant's registry (`DEC-061`); `limit` defaults to
 * `DEFAULT_INTEGRATION_SOURCE_LIMIT` and is validated against
 * `MAX_INTEGRATION_SOURCE_LIMIT` so a caller cannot request the whole register
 * unbounded. Cross-organization rows are dropped as defence in depth on top of
 * the store's own filter.
 */
export async function listIntegrationSources(
  store: IntegrationSourceReadStore,
  query: ListIntegrationSourcesQuery,
): Promise<readonly IntegrationSourceRecord[]> {
  const limit = query.limit ?? DEFAULT_INTEGRATION_SOURCE_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INTEGRATION_SOURCE_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_INTEGRATION_SOURCE_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listIntegrationSources({
    organizationId: query.organizationId,
    limit,
    offset,
  });
  return rows.filter((row) => row.organizationId === query.organizationId);
}
