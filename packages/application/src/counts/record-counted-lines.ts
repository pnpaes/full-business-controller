import { DomainError, STOCK_QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import { getStockBalanceAsOf } from "../inventory";
import { COUNTS_AUDIT_ACTIONS } from "./actions";
import type { CountStore, StockCountLineKey } from "./types";

export interface CountedLineInput {
  readonly itemId: string;
  readonly storageAreaId: string;
  /** `null`/absent = the lot-less bucket. */
  readonly lotId?: string | null;
  /** numeric(19,6), non-negative (an observation cannot be negative). */
  readonly countedQty: string;
  readonly reasonCode?: string | null;
}

export interface RecordCountedLinesInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly stockCountId: string;
  readonly lines: readonly CountedLineInput[];
}

export interface RecordCountedLinesResult {
  readonly recorded: number;
  readonly recounted: number;
}

/** `NULLS NOT DISTINCT`-style key: an absent lot is its own bucket, not a wildcard. */
function lineKeyOf(key: StockCountLineKey): string {
  return `${key.itemId}\u0000${key.storageAreaId}\u0000${key.lotId ?? "\u0000null"}`;
}

/**
 * Records the observed `counted_qty` for one or more count lines (`INV-004`).
 *
 * A line already in the count is updated in place; a line the count did not
 * snapshot (stock found where none was expected) is created through
 * `findOrCreateStockCountLine`, with `expected_qty` snapshotted from the count
 * cutoff's balance (0 when the key has no history). A second observation of an
 * already-counted line sets `recount` — `DEC-017`'s recount path.
 *
 * The count must be open: an approved or cancelled count is rejected. Blind or
 * sighted, the command never reads anything back to the caller, so it cannot
 * leak the expected quantities a blind count is hiding.
 */
export async function recordCountedLines(
  store: CountStore,
  input: RecordCountedLinesInput,
): Promise<RecordCountedLinesResult> {
  if (input.lines.length === 0) {
    throw new DomainError("lines must not be empty");
  }
  // Pre-transaction validation: scale and sign, cheap and deterministic.
  const counted = input.lines.map((line) => {
    const value = parseDecimal(line.countedQty, STOCK_QUANTITY_SCALE);
    if (value < 0n) {
      throw new DomainError("countedQty must not be negative");
    }
    return value;
  });

  return store.withTransaction(async (tx) => {
    const count = await tx.findStockCount({
      organizationId: input.organizationId,
      stockCountId: input.stockCountId,
    });
    if (count === undefined) {
      throw new DomainError("stock count not found in organization");
    }
    if (count.status === "approved") {
      throw new DomainError("count already approved");
    }
    if (count.status === "cancelled") {
      throw new DomainError("count already cancelled");
    }

    const balances = await getStockBalanceAsOf(tx, {
      organizationId: input.organizationId,
      asOf: count.cutoff,
      locationId: count.locationId,
    });
    const expectedByKey = new Map<string, string>();
    for (const balance of balances) {
      if (balance.organizationId !== input.organizationId) {
        continue;
      }
      expectedByKey.set(
        lineKeyOf({
          stockCountId: count.id,
          itemId: balance.itemId,
          storageAreaId: balance.storageAreaId,
          lotId: balance.lotId,
        }),
        balance.quantityOnHand,
      );
    }

    let recorded = 0;
    let recounted = 0;
    for (const [index, line] of input.lines.entries()) {
      const lotId = line.lotId ?? null;
      const item = await tx.findItem(line.itemId);
      if (item === undefined || item.organizationId !== input.organizationId) {
        throw new DomainError("item not found in organization");
      }
      const storageArea = await tx.findStorageArea(line.storageAreaId);
      if (storageArea === undefined || storageArea.organizationId !== input.organizationId) {
        throw new DomainError("storage area not found in organization");
      }
      if (storageArea.locationId !== count.locationId) {
        throw new DomainError("storage area does not belong to the count location");
      }

      const countedQty = formatDecimal(counted[index]!, STOCK_QUANTITY_SCALE);
      const existing = await tx.findStockCountLine({
        organizationId: input.organizationId,
        stockCountId: count.id,
        itemId: line.itemId,
        storageAreaId: line.storageAreaId,
        lotId,
      });

      if (existing === undefined) {
        await tx.createStockCountLine({
          stockCountId: count.id,
          itemId: line.itemId,
          storageAreaId: line.storageAreaId,
          lotId,
          expectedQty:
            expectedByKey.get(
              lineKeyOf({
                stockCountId: count.id,
                itemId: line.itemId,
                storageAreaId: line.storageAreaId,
                lotId,
              }),
            ) ?? "0.000000",
          countedQty,
          varianceQty: null,
          reasonCode: line.reasonCode ?? null,
          recount: false,
        });
        recorded += 1;
        continue;
      }

      const isRecount = existing.countedQty !== null || existing.recount;
      await tx.updateStockCountLine(existing.id, {
        countedQty,
        reasonCode: line.reasonCode ?? existing.reasonCode,
        recount: isRecount,
      });
      if (isRecount) {
        recounted += 1;
      } else {
        recorded += 1;
      }
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COUNTS_AUDIT_ACTIONS.linesRecorded,
      entityType: "stock_count",
      entityId: count.id,
      after: { recorded, recounted },
    });

    return { recorded, recounted };
  });
}
