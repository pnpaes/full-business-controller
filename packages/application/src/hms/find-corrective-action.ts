import type { HmsStore, CorrectiveActionRecord } from "./types";

export interface FindCorrectiveActionQuery {
  readonly organizationId: string;
  readonly correctiveActionId: string;
}

/**
 * One corrective action by id, organization-scoped (`DEC-061`), or `undefined`.
 * A missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of an action outside its organization.
 */
export async function findCorrectiveAction(
  store: HmsStore,
  query: FindCorrectiveActionQuery,
): Promise<CorrectiveActionRecord | undefined> {
  return store.findCorrectiveAction({
    organizationId: query.organizationId,
    correctiveActionId: query.correctiveActionId,
  });
}
