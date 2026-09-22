import type { PeriodCloseRecord, PeriodCloseStore } from "./types";

export interface FindPeriodCloseQuery {
  readonly organizationId: string;
  readonly periodCloseId: string;
}

/**
 * One close by id, organization-scoped (`DEC-061`), or `undefined`. A missing id
 * and another tenant's id are indistinguishable, so a caller cannot probe for the
 * existence of a close outside its organization.
 */
export async function findPeriodClose(
  store: PeriodCloseStore,
  query: FindPeriodCloseQuery,
): Promise<PeriodCloseRecord | undefined> {
  return store.findPeriodClose({
    organizationId: query.organizationId,
    id: query.periodCloseId,
  });
}
