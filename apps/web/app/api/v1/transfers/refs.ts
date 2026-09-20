import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryStore,
  InventoryUnitRecord,
} from "@aquarela/application";

import type { TransferRefs } from "./transfer-rows";

/**
 * Shared reference-record loader for the transfer read surfaces. The list and
 * the detail need the same display fields (location/area labels, item code/name,
 * base-unit code); loading them one query per distinct id — never per row —
 * keeps the query count bounded and the two surfaces from drifting.
 */

function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function toMap<T extends { readonly id: string }>(
  records: readonly (T | undefined)[],
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (record !== undefined) {
      map.set(record.id, record);
    }
  }
  return map;
}

export interface TransferRefIds {
  readonly locationIds: Iterable<string>;
  readonly storageAreaIds: Iterable<string>;
  readonly itemIds: Iterable<string>;
}

export async function loadTransferRefs(
  store: InventoryStore,
  ids: TransferRefIds,
): Promise<TransferRefs> {
  const locationIds = distinct(ids.locationIds);
  const storageAreaIds = distinct(ids.storageAreaIds);
  const itemIds = distinct(ids.itemIds);

  const [locations, storageAreas, items] = await Promise.all([
    Promise.all(locationIds.map((id) => store.findLocation(id))),
    Promise.all(storageAreaIds.map((id) => store.findStorageArea(id))),
    Promise.all(itemIds.map((id) => store.findItem(id))),
  ]);

  const unitIds = distinct(items.flatMap((item) => (item === undefined ? [] : [item.baseUnitId])));
  const units = await Promise.all(unitIds.map((id) => store.findUnit(id)));

  return {
    locations: toMap<InventoryLocationRecord>(locations),
    storageAreas: toMap<InventoryStorageAreaRecord>(storageAreas),
    items: toMap<InventoryItemRecord>(items),
    units: toMap<InventoryUnitRecord>(units),
  };
}
