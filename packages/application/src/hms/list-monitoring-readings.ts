import type { HmsStore, MonitoringReadingRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MONITORING_READING_LIMIT = 50;

export interface ListMonitoringReadingsQuery {
  readonly organizationId: string;
  readonly monitoringPointId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Monitoring readings for one organization, newest `measured_at` first (then
 * `id`), with an optional point filter. The organization filter is never
 * optional (`DEC-061`); `limit` defaults to `DEFAULT_MONITORING_READING_LIMIT` so
 * the per-point time series is read in bounded pages.
 */
export async function listMonitoringReadings(
  store: HmsStore,
  query: ListMonitoringReadingsQuery,
): Promise<readonly MonitoringReadingRecord[]> {
  return store.listMonitoringReadings({
    organizationId: query.organizationId,
    ...(query.monitoringPointId === undefined
      ? {}
      : { monitoringPointId: query.monitoringPointId }),
    limit: query.limit ?? DEFAULT_MONITORING_READING_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
