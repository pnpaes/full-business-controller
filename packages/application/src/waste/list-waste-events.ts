import { DomainError } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";

import type { WasteEventRecord, WasteStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_WASTE_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the event log for an unbounded page. */
export const MAX_WASTE_LIMIT = 200;

export interface ListWasteEventsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly itemId?: string;
  readonly stage?: string;
  /** ISO instant; inclusive lower bound on `occurred_at`. */
  readonly occurredFrom?: string;
  /** ISO instant; inclusive upper bound on `occurred_at`. */
  readonly occurredTo?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface WasteEventPage {
  readonly events: readonly WasteEventRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Waste events for one organization (`WASTE-001`), newest first, with optional
 * location/item/stage and `occurred_at` window filters. The read is bounded:
 * `limit` defaults to `DEFAULT_WASTE_LIMIT` and is capped, and `hasMore` is
 * derived by fetching one row past the page. An invalid instant, a non-integer
 * or out-of-range `limit`/`offset` is rejected before the store is touched, so
 * the route maps one error class to 400.
 */
export async function listWasteEvents(
  store: WasteStore,
  query: ListWasteEventsQuery,
): Promise<WasteEventPage> {
  if (query.occurredFrom !== undefined) {
    assertIsoInstant(query.occurredFrom, "occurredFrom");
  }
  if (query.occurredTo !== undefined) {
    assertIsoInstant(query.occurredTo, "occurredTo");
  }
  const limit = query.limit ?? DEFAULT_WASTE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WASTE_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_WASTE_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listWasteEvents({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
    ...(query.stage === undefined ? {} : { stage: query.stage }),
    ...(query.occurredFrom === undefined ? {} : { occurredFrom: new Date(query.occurredFrom) }),
    ...(query.occurredTo === undefined ? {} : { occurredTo: new Date(query.occurredTo) }),
    limit: limit + 1,
    offset,
  });

  const hasMore = rows.length > limit;
  return {
    events: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
