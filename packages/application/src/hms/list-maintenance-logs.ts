import type { HmsStore, MaintenanceLogRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MAINTENANCE_LOG_LIMIT = 50;

export interface ListMaintenanceLogsQuery {
  readonly organizationId: string;
  readonly equipmentId?: string;
  /** One of `MAINTENANCE_KIND`, exact match. */
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Maintenance logs for one organization, newest `performed_at` first, with
 * optional equipment and kind filters. The organization filter is never
 * optional, so a caller cannot read another tenant's maintenance facts
 * (`DEC-061`); `limit` defaults to `DEFAULT_MAINTENANCE_LOG_LIMIT` so a caller
 * cannot ask for the whole log unbounded.
 */
export async function listMaintenanceLogs(
  store: HmsStore,
  query: ListMaintenanceLogsQuery,
): Promise<readonly MaintenanceLogRecord[]> {
  return store.listMaintenanceLogs({
    organizationId: query.organizationId,
    ...(query.equipmentId === undefined ? {} : { equipmentId: query.equipmentId }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    limit: query.limit ?? DEFAULT_MAINTENANCE_LOG_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
