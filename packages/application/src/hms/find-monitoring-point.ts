import type { HmsStore, MonitoringPointRecord } from "./types";

export interface FindMonitoringPointQuery {
  readonly organizationId: string;
  readonly monitoringPointId: string;
}

/**
 * One monitoring point by id, organization-scoped (`DEC-061`), or `undefined`.
 * A missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of a point outside its organization. The web layer
 * resolves the point's `locationId` through this before authorizing an edit.
 */
export async function findMonitoringPoint(
  store: HmsStore,
  query: FindMonitoringPointQuery,
): Promise<MonitoringPointRecord | undefined> {
  return store.findMonitoringPoint({
    organizationId: query.organizationId,
    monitoringPointId: query.monitoringPointId,
  });
}
