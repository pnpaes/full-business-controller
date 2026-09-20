import type { InventoryStorageAreaRecord, InventoryStore } from "./types";

export interface ListStorageAreasQuery {
  readonly organizationId: string;
  /** Absent = every location; present = that location only. */
  readonly locationId?: string;
}

/**
 * The storage areas a caller may post into (DATA_DICTIONARY §4): the option list
 * for the movement form and the rows of the storage-areas section. Read-only and
 * org-scoped; an area returned by another organization is dropped as defence in
 * depth on top of the store's own filter.
 */
export async function listStorageAreas(
  store: InventoryStore,
  query: ListStorageAreasQuery,
): Promise<readonly InventoryStorageAreaRecord[]> {
  const rows = await store.listStorageAreas({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
  });
  return rows.filter((area) => area.organizationId === query.organizationId);
}
