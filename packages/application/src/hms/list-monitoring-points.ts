import type { HmsStore, MonitoringPointRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MONITORING_POINT_LIMIT = 50;

export interface ListMonitoringPointsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** When true, only `active` points are returned; when omitted, all are. */
  readonly activeOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Monitoring points for one organization, ordered by `code` (then `id`), with
 * optional location and active-only filters. The organization filter is never
 * optional, so a caller cannot read another tenant's points (`DEC-061`); `limit`
 * defaults to `DEFAULT_MONITORING_POINT_LIMIT` so a caller cannot ask for the
 * whole register unbounded.
 */
export async function listMonitoringPoints(
  store: HmsStore,
  query: ListMonitoringPointsQuery,
): Promise<readonly MonitoringPointRecord[]> {
  return store.listMonitoringPoints({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.activeOnly === undefined ? {} : { activeOnly: query.activeOnly }),
    limit: query.limit ?? DEFAULT_MONITORING_POINT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
