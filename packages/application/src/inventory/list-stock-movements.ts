import { DomainError } from "@aquarela/domain";

import type { InventoryStore, StockMovementRecord } from "./types";
import { assertIsoInstant } from "./validation";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MOVEMENT_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the ledger for an unbounded page. */
export const MAX_MOVEMENT_LIMIT = 200;

export interface ListStockMovementsQuery {
  readonly organizationId: string;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string;
  /** `null` matches only the no-lot movements; absent = no lot filter. */
  readonly lotId?: string | null;
  /** ISO instant; inclusive lower bound on `occurred_at`. */
  readonly occurredFrom?: string;
  /** ISO instant; inclusive upper bound on `occurred_at`. */
  readonly occurredTo?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StockMovementPage {
  readonly movements: readonly StockMovementRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Movement history for one organization (INV-001, 08_UI_UX.md §8.3 movement
 * drill-down), in ledger order. The read is bounded: `limit` defaults to
 * `DEFAULT_MOVEMENT_LIMIT` and is capped, and `hasMore` is derived by fetching
 * one row past the page rather than running a second count query. An invalid
 * instant, a non-integer or out-of-range `limit`/`offset` is rejected before the
 * store is touched, so the route maps one error class to 400.
 */
export async function listStockMovements(
  store: InventoryStore,
  query: ListStockMovementsQuery,
): Promise<StockMovementPage> {
  if (query.occurredFrom !== undefined) {
    assertIsoInstant(query.occurredFrom, "occurredFrom");
  }
  if (query.occurredTo !== undefined) {
    assertIsoInstant(query.occurredTo, "occurredTo");
  }
  const limit = query.limit ?? DEFAULT_MOVEMENT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MOVEMENT_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_MOVEMENT_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listStockMovements({
    organizationId: query.organizationId,
    ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.storageAreaId === undefined ? {} : { storageAreaId: query.storageAreaId }),
    ...(query.lotId === undefined ? {} : { lotId: query.lotId }),
    ...(query.occurredFrom === undefined ? {} : { occurredFrom: new Date(query.occurredFrom) }),
    ...(query.occurredTo === undefined ? {} : { occurredTo: new Date(query.occurredTo) }),
    limit: limit + 1,
    offset,
  });

  const hasMore = rows.length > limit;
  return {
    movements: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
