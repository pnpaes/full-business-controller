import type { HmsStore, IncidentRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_INCIDENT_LIMIT = 50;

export interface ListIncidentsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly locationId?: string;
  /** Inclusive lower bound on `occurred_at`; an ISO instant. */
  readonly from?: string;
  /** Inclusive upper bound on `occurred_at`; an ISO instant. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Incidents for one organization, newest `occurred_at` first (then `id`), with
 * optional status and location filters and an inclusive `occurred_at` window
 * (`from`/`to`; either bound may be omitted). The organization filter is never
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
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_INCIDENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
