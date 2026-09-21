import type { HmsStore, MaintenanceLogRecord } from "./types";

export interface FindMaintenanceLogQuery {
  readonly organizationId: string;
  readonly maintenanceLogId: string;
}

/**
 * One maintenance log by id, organization-scoped (`DEC-061`), or `undefined`. A
 * missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of a maintenance fact outside its organization.
 */
export async function findMaintenanceLog(
  store: HmsStore,
  query: FindMaintenanceLogQuery,
): Promise<MaintenanceLogRecord | undefined> {
  return store.findMaintenanceLog({
    organizationId: query.organizationId,
    maintenanceLogId: query.maintenanceLogId,
  });
}
