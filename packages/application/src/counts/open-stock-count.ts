import { DomainError } from "@aquarela/domain";

import { getStockBalanceAsOf } from "../inventory";
import { assertIsoInstant } from "../inventory/validation";
import { COUNTS_AUDIT_ACTIONS } from "./actions";
import type { CountStore } from "./types";

export interface OpenStockCountInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** ISO instant: the economic cutoff the expected quantities are snapshotted at. */
  readonly cutoff: string;
  /** Blind counts hide the expected quantities from the entry surface (`DEC-017`). */
  readonly blind: boolean;
  /**
   * Optional deterministic id. A replay of an existing id returns that count
   * unchanged (`replayed: true`) instead of creating a second count, which is
   * how the idempotent seed opens its demo count.
   */
  readonly stockCountId?: string;
}

export interface OpenStockCountResult {
  readonly stockCountId: string;
  readonly lineCount: number;
  readonly replayed: boolean;
}

/**
 * Opens a count (`INV-004`, `DEC-017`): creates the header and one line per
 * `(item, storage_area, lot)` group that has ledger history at `cutoff`,
 * snapshotting each line's `expected_qty` from `getStockBalanceAsOf` (`INV-002`).
 *
 * The line set is derived from the cutoff balances rather than a `scope` filter:
 * the jsonb `scope` shape is not pinned by any authority, so this command
 * persists `{}` and does not invent one (open point — see the slice-9 report).
 * The count opens in `counting`: ready for `recordCountedLines` and
 * `approveStockCount`.
 *
 * Everything runs in one transaction (header, lines and the audit fact) so a
 * half-opened count cannot be observed.
 */
export async function openStockCount(
  store: CountStore,
  input: OpenStockCountInput,
): Promise<OpenStockCountResult> {
  assertIsoInstant(input.cutoff, "cutoff");

  return store.withTransaction(async (tx) => {
    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    if (input.stockCountId !== undefined) {
      const existing = await tx.findStockCount({
        organizationId: input.organizationId,
        stockCountId: input.stockCountId,
      });
      if (existing !== undefined) {
        const lines = await tx.listStockCountLines({
          organizationId: input.organizationId,
          stockCountId: existing.id,
        });
        return { stockCountId: existing.id, lineCount: lines.length, replayed: true };
      }
    }

    const balances = await getStockBalanceAsOf(tx, {
      organizationId: input.organizationId,
      asOf: input.cutoff,
      locationId: input.locationId,
    });

    const count = await tx.createStockCount({
      organizationId: input.organizationId,
      locationId: input.locationId,
      // Unshaped: persisted verbatim, never interpreted (open point).
      scope: {},
      blind: input.blind,
      cutoff: input.cutoff,
      status: "counting",
      createdBy: input.actorId,
      ...(input.stockCountId === undefined ? {} : { id: input.stockCountId }),
    });

    let lineCount = 0;
    for (const balance of balances) {
      // Defence in depth on top of the org-scoped as-of read.
      if (balance.organizationId !== input.organizationId) {
        continue;
      }
      await tx.createStockCountLine({
        stockCountId: count.id,
        itemId: balance.itemId,
        storageAreaId: balance.storageAreaId,
        lotId: balance.lotId,
        expectedQty: balance.quantityOnHand,
        countedQty: null,
        varianceQty: null,
        reasonCode: null,
        recount: false,
      });
      lineCount += 1;
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COUNTS_AUDIT_ACTIONS.countOpened,
      entityType: "stock_count",
      entityId: count.id,
      after: {
        location_id: input.locationId,
        cutoff: input.cutoff,
        blind: input.blind,
        line_count: lineCount,
      },
    });

    return { stockCountId: count.id, lineCount, replayed: false };
  });
}
