import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryStore,
  InventoryUnitRecord,
  StockBalanceAsOfEntry,
  StockLotRecord,
  StockMovementRecord,
} from "@aquarela/application";

import type { BalanceRefs } from "./balances/balance-rows";
import type { MovementRefs } from "./movement-rows";

/**
 * Shared reference-record loaders for the inventory read surfaces. Both the
 * balances route/page and the movement route/page need the same display fields
 * for a page of rows; loading them one query per distinct id (never per row)
 * keeps the two surfaces from drifting and keeps the query count bounded.
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

export async function loadBalanceRefs(
  store: InventoryStore,
  balances: readonly StockBalanceAsOfEntry[],
): Promise<BalanceRefs> {
  const itemIds = distinct(balances.map((balance) => balance.itemId));
  const locationIds = distinct(balances.map((balance) => balance.locationId));
  const areaIds = distinct(balances.map((balance) => balance.storageAreaId));
  const lotIds = distinct(
    balances.flatMap((balance) => (balance.lotId === null ? [] : [balance.lotId])),
  );

  const [items, locations, storageAreas, lots] = await Promise.all([
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(locationIds.map((id) => store.findLocation(id))),
    Promise.all(areaIds.map((id) => store.findStorageArea(id))),
    Promise.all(lotIds.map((id) => store.findStockLot(id))),
  ]);

  const unitIds = distinct(items.flatMap((item) => (item === undefined ? [] : [item.baseUnitId])));
  const units = await Promise.all(unitIds.map((id) => store.findUnit(id)));

  return {
    items: toMap<InventoryItemRecord>(items),
    units: toMap<InventoryUnitRecord>(units),
    locations: toMap<InventoryLocationRecord>(locations),
    storageAreas: toMap<InventoryStorageAreaRecord>(storageAreas),
    lots: toMap<StockLotRecord>(lots),
  };
}

export async function loadMovementRefs(
  store: InventoryStore,
  movements: readonly StockMovementRecord[],
): Promise<MovementRefs> {
  const itemIds = distinct(movements.map((movement) => movement.itemId));
  const unitIds = distinct(movements.map((movement) => movement.unitId));
  const locationIds = distinct(movements.map((movement) => movement.locationId));
  const areaIds = distinct(movements.map((movement) => movement.storageAreaId));
  const lotIds = distinct(
    movements.flatMap((movement) => (movement.lotId === null ? [] : [movement.lotId])),
  );

  const [items, units, locations, storageAreas, lots] = await Promise.all([
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(unitIds.map((id) => store.findUnit(id))),
    Promise.all(locationIds.map((id) => store.findLocation(id))),
    Promise.all(areaIds.map((id) => store.findStorageArea(id))),
    Promise.all(lotIds.map((id) => store.findStockLot(id))),
  ]);

  return {
    items: toMap<InventoryItemRecord>(items),
    units: toMap<InventoryUnitRecord>(units),
    locations: toMap<InventoryLocationRecord>(locations),
    storageAreas: toMap<InventoryStorageAreaRecord>(storageAreas),
    lots: toMap<StockLotRecord>(lots),
  };
}

/**
 * The movement ids on this page that already have a reversal, so the reverse
 * action can be disabled. One bounded query per row (the page is capped at 200).
 */
export async function loadReversedIds(
  store: InventoryStore,
  movements: readonly StockMovementRecord[],
): Promise<ReadonlySet<string>> {
  const reversals = await Promise.all(
    movements.map((movement) => store.findStockMovementReversal(movement.id)),
  );
  const reversed = new Set<string>();
  movements.forEach((movement, index) => {
    if (reversals[index] !== undefined) {
      reversed.add(movement.id);
    }
  });
  return reversed;
}
