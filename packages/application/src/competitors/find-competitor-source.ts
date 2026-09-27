import type { CompetitorSourceRecord, CompetitorStore } from "./types";
import { assertUuid } from "./validation";

export interface FindCompetitorSourceQuery {
  readonly organizationId: string;
  readonly sourceId: string;
}

/**
 * One competitor source by id, organization-scoped (`DEC-061`), or `undefined`
 * for a missing or cross-organization id (`ADR-0010`/`DEC-143`).
 */
export async function findCompetitorSource(
  store: CompetitorStore,
  query: FindCompetitorSourceQuery,
): Promise<CompetitorSourceRecord | undefined> {
  assertUuid(query.sourceId, "sourceId");
  return store.findCompetitorSource(query);
}
