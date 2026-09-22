import type { HmsStore, MonitoringReadingRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MONITORING_READING_LIMIT = 50;

export interface ListMonitoringReadingsQuery {
  readonly organizationId: string;
  readonly monitoringPointId?: string;
  /** Inclusive lower bound on `measured_at`; an ISO instant. */
  readonly from?: string;
  /** Inclusive upper bound on `measured_at`; an ISO instant. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Monitoring readings for one organization, newest `measured_at` first (then
 * `id`), with an optional point filter and an inclusive `measured_at` window
 * (`from`/`to`; either bound may be omitted). The organization filter is never
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
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_MONITORING_READING_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
