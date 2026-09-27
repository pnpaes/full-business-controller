import { DomainError } from "@aquarela/domain";
import { AI_SUGGESTION_STATE } from "@aquarela/persistence";

import type {
  AiSuggestionReadStore,
  AiSuggestionRecord,
  ListAiSuggestionsQuery,
} from "./read-types";
import { DEFAULT_AI_SUGGESTION_LIMIT, MAX_AI_SUGGESTION_LIMIT } from "./read-types";

/**
 * The organization's AI suggestions (`ADR-0009`, `DEC-142`), newest first. The
 * organization filter is never optional, so a caller cannot read another
 * tenant's queue (`DEC-061`); `limit` defaults to
 * `DEFAULT_AI_SUGGESTION_LIMIT` and is validated against
 * `MAX_AI_SUGGESTION_LIMIT` so a caller cannot request the whole queue
 * unbounded. An unknown `state` filter is a `DomainError` rather than a silent
 * empty page. Cross-organization rows are dropped as defence in depth on top of
 * the store's own filter.
 */
export async function listAiSuggestions(
  store: AiSuggestionReadStore,
  query: ListAiSuggestionsQuery,
): Promise<readonly AiSuggestionRecord[]> {
  if (
    query.state !== undefined &&
    !(AI_SUGGESTION_STATE as readonly string[]).includes(query.state)
  ) {
    throw new DomainError(`state must be one of ${AI_SUGGESTION_STATE.join(", ")}`);
  }
  const limit = query.limit ?? DEFAULT_AI_SUGGESTION_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AI_SUGGESTION_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_AI_SUGGESTION_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listAiSuggestions({
    organizationId: query.organizationId,
    ...(query.state === undefined ? {} : { state: query.state }),
    limit,
    offset,
  });
  return rows.filter((row) => row.organizationId === query.organizationId);
}
