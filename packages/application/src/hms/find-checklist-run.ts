import type { ChecklistRunRecord, HmsStore } from "./types";

export interface FindChecklistRunQuery {
  readonly organizationId: string;
  readonly runId: string;
}

/**
 * One checklist run by id, organization-scoped (`DEC-061`), or `undefined`. A
 * missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of a run outside its organization. The web layer
 * resolves the run's `locationId` through this before authorizing an edit.
 */
export async function findChecklistRun(
  store: HmsStore,
  query: FindChecklistRunQuery,
): Promise<ChecklistRunRecord | undefined> {
  return store.findChecklistRun({
    organizationId: query.organizationId,
    runId: query.runId,
  });
}
