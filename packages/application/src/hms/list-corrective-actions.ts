import type { HmsStore, CorrectiveActionRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_CORRECTIVE_ACTION_LIMIT = 50;

export interface ListCorrectiveActionsQuery {
  readonly organizationId: string;
  readonly incidentId?: string;
  readonly status?: string;
  readonly ownerId?: string;
  /** Inclusive lower bound on `due_date`; a `YYYY-MM-DD` day (a `date` column). */
  readonly from?: string;
  /** Inclusive upper bound on `due_date`; a `YYYY-MM-DD` day. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Corrective actions for one organization, earliest `due_date` first (then `id`;
 * a null due date sorts last), with optional incident/status/owner filters and
 * an inclusive `due_date` window (`from`/`to`, each a `YYYY-MM-DD` day; either
 * bound may be omitted — a null due date falls outside any bounded window). The
 * organization filter is never optional, so a caller cannot read another
 * tenant's actions (`DEC-061`); `limit` defaults to
 * `DEFAULT_CORRECTIVE_ACTION_LIMIT` so a caller cannot ask for the whole
 * register unbounded.
 */
export async function listCorrectiveActions(
  store: HmsStore,
  query: ListCorrectiveActionsQuery,
): Promise<readonly CorrectiveActionRecord[]> {
  return store.listCorrectiveActions({
    organizationId: query.organizationId,
    ...(query.incidentId === undefined ? {} : { incidentId: query.incidentId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_CORRECTIVE_ACTION_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
