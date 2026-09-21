import type { EquipmentRecord, HmsStore } from "./types";

export interface FindEquipmentQuery {
  readonly organizationId: string;
  readonly equipmentId: string;
}

/**
 * One equipment row by id, organization-scoped (`DEC-061`), or `undefined`. A
 * missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of equipment outside its organization.
 */
export async function findEquipment(
  store: HmsStore,
  query: FindEquipmentQuery,
): Promise<EquipmentRecord | undefined> {
  return store.findEquipment({
    organizationId: query.organizationId,
    equipmentId: query.equipmentId,
  });
}
