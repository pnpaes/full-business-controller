import type { HmsStore, IncidentRecord } from "./types";

export interface FindIncidentQuery {
  readonly organizationId: string;
  readonly incidentId: string;
}

/**
 * One incident by id, organization-scoped (`DEC-061`), or `undefined`. A missing
 * id and another tenant's id are indistinguishable, so a caller cannot probe for
 * the existence of an incident outside its organization. The web layer resolves
 * the incident's `locationId` through this before authorizing an edit.
 */
export async function findIncident(
  store: HmsStore,
  query: FindIncidentQuery,
): Promise<IncidentRecord | undefined> {
  return store.findIncident({
    organizationId: query.organizationId,
    incidentId: query.incidentId,
  });
}
