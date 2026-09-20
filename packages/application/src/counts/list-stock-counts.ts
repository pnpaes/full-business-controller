import { STOCK_QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";

import type { CountStore, StockCountRecord } from "./types";
import { getStockCount } from "./get-stock-count";

export interface StockCountSummary {
  readonly count: StockCountRecord;
  readonly lineCount: number;
  readonly countedCount: number;
  /**
   * Lines whose observed quantity differs from the expected snapshot. `null`
   * while a blind count is unapproved: the count of mismatches is itself a hint
   * about the hidden book quantities (`DEC-017`), so it is withheld like the
   * quantities themselves.
   */
  readonly varianceCount: number | null;
}

export interface ListStockCountsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  /** Defaults to 50; the API caps it at 200. */
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Counts for one organization, newest cutoff first (`cutoff`, then `id`), each
 * summarised with its line/observed/variance counts for the list screen
 * (08_UI_UX.md §8.3). The variances are derived through `getStockCount`, so the
 * blind-count withholding rule lives in exactly one place.
 *
 * There is no batch line read in the persistence repository, so this loads the
 * lines per count; the list is bounded by `limit` (default 50, max 200).
 */
export async function listStockCounts(
  store: CountStore,
  query: ListStockCountsQuery,
): Promise<readonly StockCountSummary[]> {
  const counts = await store.listStockCounts({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    limit: query.limit ?? 50,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });

  const summaries: StockCountSummary[] = [];
  for (const count of counts) {
    if (count.organizationId !== query.organizationId) {
      continue;
    }
    const detail = await getStockCount(store, {
      organizationId: query.organizationId,
      stockCountId: count.id,
    });
    const lines = detail?.lines ?? [];
    const varianceCount = detail?.expectedHidden
      ? null
      : lines.filter(
          (line) =>
            line.varianceQty !== null &&
            parseDecimal(line.varianceQty, STOCK_QUANTITY_SCALE) !== 0n,
        ).length;
    summaries.push({
      count,
      lineCount: lines.length,
      countedCount: lines.filter((line) => line.countedQty !== null).length,
      varianceCount,
    });
  }
  return summaries;
}
