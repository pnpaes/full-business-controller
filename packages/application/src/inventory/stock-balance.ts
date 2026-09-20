import { deriveAverageUnitCost } from "@aquarela/domain";

import type { InventoryStore, StockBalanceKey } from "./types";
import { assertIsoInstant } from "./validation";

export interface StockBalanceAsOfEntry extends StockBalanceKey {
  /** numeric(19,6). */
  readonly quantityOnHand: string;
  /** numeric(19,4). */
  readonly valueOnHand: string;
  /** numeric(19,4), null at zero quantity. */
  readonly avgUnitCost: string | null;
}

/**
 * The balance for every `(item, location, storage_area, lot)` group that has
 * movements with `occurred_at <= asOf` (INV-002: balance = Σ movements at the
 * cutoff). Every group with a movement is returned, including a zero-quantity /
 * zero-value group, so the caller sees that history exists.
 *
 * The store aggregates the ledger in SQL (the application never loads the
 * movement rows); the average is derived here via the domain's single-source
 * helper so the valuation rule stays in one place.
 */
export async function getStockBalanceAsOf(
  store: InventoryStore,
  query: {
    readonly organizationId: string;
    /** ISO timestamp cutoff. */
    readonly asOf: string;
    readonly itemId?: string;
    readonly locationId?: string;
  },
): Promise<readonly StockBalanceAsOfEntry[]> {
  assertIsoInstant(query.asOf, "asOf");
  const sums = await store.sumStockMovementsAsOf({
    organizationId: query.organizationId,
    asOf: new Date(query.asOf),
    ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
  });

  return sums.map((sum) => ({
    organizationId: sum.organizationId,
    itemId: sum.itemId,
    locationId: sum.locationId,
    storageAreaId: sum.storageAreaId,
    lotId: sum.lotId,
    quantityOnHand: sum.quantityOnHand,
    valueOnHand: sum.valueOnHand,
    avgUnitCost: deriveAverageUnitCost(sum.quantityOnHand, sum.valueOnHand),
  }));
}
