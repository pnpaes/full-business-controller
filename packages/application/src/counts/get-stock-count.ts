import { STOCK_QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import type { CountStore, StockCountLineRecord, StockCountRecord } from "./types";

export interface StockCountLineView {
  readonly id: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  /** Hidden (`null`) while a blind count is unapproved (`DEC-017`). */
  readonly expectedQty: string | null;
  readonly countedQty: string | null;
  /** `counted − expected`; hidden while a blind count is unapproved. */
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly recount: boolean;
}

export interface StockCountDetail {
  readonly count: StockCountRecord;
  readonly lines: readonly StockCountLineView[];
  /** True when the expected quantities are withheld from this read. */
  readonly expectedHidden: boolean;
}

/**
 * True while the read must withhold `expected_qty`/`variance_qty`: a blind count
 * (`DEC-017`) hides them from the entry surface until it is approved, so a
 * counter cannot back-solve the book quantity from the variance.
 */
function hidesExpected(count: StockCountRecord): boolean {
  return count.blind && count.status !== "approved";
}

/**
 * One count with its lines and variances (`INV-004`). A blind, unapproved count
 * returns `expectedQty: null` and `varianceQty: null` (and `expectedHidden:
 * true`), which is what the API and the entry screen rely on.
 */
export async function getStockCount(
  store: CountStore,
  query: { readonly organizationId: string; readonly stockCountId: string },
): Promise<StockCountDetail | undefined> {
  const count = await store.findStockCount(query);
  if (count === undefined || count.organizationId !== query.organizationId) {
    return undefined;
  }
  const lines = await store.listStockCountLines({
    organizationId: query.organizationId,
    stockCountId: count.id,
  });
  const expectedHidden = hidesExpected(count);

  return {
    count,
    expectedHidden,
    lines: lines.map((line) => toLineView(line, expectedHidden)),
  };
}

function toLineView(line: StockCountLineRecord, expectedHidden: boolean): StockCountLineView {
  if (expectedHidden) {
    return {
      id: line.id,
      itemId: line.itemId,
      storageAreaId: line.storageAreaId,
      lotId: line.lotId,
      expectedQty: null,
      countedQty: line.countedQty,
      varianceQty: null,
      reasonCode: line.reasonCode,
      recount: line.recount,
    };
  }
  const varianceQty =
    line.countedQty === null
      ? null
      : formatDecimal(
          parseDecimal(line.countedQty, STOCK_QUANTITY_SCALE) -
            parseDecimal(line.expectedQty, STOCK_QUANTITY_SCALE),
          STOCK_QUANTITY_SCALE,
        );
  return {
    id: line.id,
    itemId: line.itemId,
    storageAreaId: line.storageAreaId,
    lotId: line.lotId,
    expectedQty: line.expectedQty,
    countedQty: line.countedQty,
    varianceQty,
    reasonCode: line.reasonCode,
    recount: line.recount,
  };
}
