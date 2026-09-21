import type { HmsStore, CorrectiveActionRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_CORRECTIVE_ACTION_LIMIT = 50;

export interface ListCorrectiveActionsQuery {
  readonly organizationId: string;
  readonly incidentId?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Corrective actions for one organization, earliest `due_date` first (then `id`;
 * a null due date sorts last), with optional incident/status/owner filters. The
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
    limit: query.limit ?? DEFAULT_CORRECTIVE_ACTION_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
