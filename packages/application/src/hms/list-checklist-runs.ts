import type { ChecklistRunRecord, HmsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_CHECKLIST_RUN_LIMIT = 50;

export interface ListChecklistRunsQuery {
  readonly organizationId: string;
  readonly templateId?: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Checklist runs for one organization, newest `run_at` first (then id), with
 * optional template/location/status filters. The organization filter is never
 * optional, so a caller cannot read another tenant's runs (`DEC-061`); `limit`
 * defaults to `DEFAULT_CHECKLIST_RUN_LIMIT` so a caller cannot ask for the whole
 * register unbounded.
 */
export async function listChecklistRuns(
  store: HmsStore,
  query: ListChecklistRunsQuery,
): Promise<readonly ChecklistRunRecord[]> {
  return store.listChecklistRuns({
    organizationId: query.organizationId,
    ...(query.templateId === undefined ? {} : { templateId: query.templateId }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    limit: query.limit ?? DEFAULT_CHECKLIST_RUN_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
