import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  WasteEventRecord,
  WasteProductVariantRecord,
  WasteStore,
} from "@aquarela/application";

import type { WasteRefs } from "./waste-rows";

/**
 * Shared reference-record loader for the waste read surfaces: one query per
 * distinct id (never per row), so the list route and the list page cannot drift
 * and the query count stays bounded.
 */

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

function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export async function loadWasteRefs(
  store: WasteStore,
  events: readonly WasteEventRecord[],
): Promise<WasteRefs> {
  const itemIds = distinct(
    events.flatMap((event) => (event.itemId === null ? [] : [event.itemId])),
  );
  const variantIds = distinct(
    events.flatMap((event) => (event.productVariantId === null ? [] : [event.productVariantId])),
  );
  const unitIds = distinct(events.map((event) => event.unitId));
  const locationIds = distinct(events.map((event) => event.locationId));
  const areaIds = distinct(events.map((event) => event.storageAreaId));

  const [items, productVariants, units, locations, storageAreas] = await Promise.all([
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(variantIds.map((id) => store.findProductVariant(id))),
    Promise.all(unitIds.map((id) => store.findUnit(id))),
    Promise.all(locationIds.map((id) => store.findLocation(id))),
    Promise.all(areaIds.map((id) => store.findStorageArea(id))),
  ]);

  return {
    items: toMap<InventoryItemRecord>(items),
    productVariants: toMap<WasteProductVariantRecord>(productVariants),
    units: toMap<InventoryUnitRecord>(units),
    locations: toMap<InventoryLocationRecord>(locations),
    storageAreas: toMap<InventoryStorageAreaRecord>(storageAreas),
  };
}
