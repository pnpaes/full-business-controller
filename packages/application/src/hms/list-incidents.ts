import type { HmsStore, IncidentRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_INCIDENT_LIMIT = 50;

export interface ListIncidentsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Incidents for one organization, newest `occurred_at` first (then `id`), with
 * optional status and location filters. The organization filter is never
 * optional, so a caller cannot read another tenant's incidents (`DEC-061`);
 * `limit` defaults to `DEFAULT_INCIDENT_LIMIT` so a caller cannot ask for the
 * whole register unbounded.
 */
export async function listIncidents(
  store: HmsStore,
  query: ListIncidentsQuery,
): Promise<readonly IncidentRecord[]> {
  return store.listIncidents({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    limit: query.limit ?? DEFAULT_INCIDENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
