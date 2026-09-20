import {
  DomainError,
  MONEY_SCALE,
  STOCK_QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { postStockMovements } from "../inventory";
import { COUNTS_AUDIT_ACTIONS } from "./actions";
import type { CountStore } from "./types";

export interface ApproveStockCountInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly stockCountId: string;
  /**
   * Caller-supplied unit cost for the **positive** variances (numeric(19,4),
   * non-negative). When absent, each positive variance falls back to the item's
   * `current_cost`; if that is also null the approval is rejected. The source of
   * this cost is undecided (open point — see the slice-9 report); the
   * `current_cost` fallback is a provisional choice, not a decision.
   */
  readonly unitCost?: string | null;
  /** Defaults to "count adjustment"; `count_adjustment` requires a reason. */
  readonly reasonCode?: string | null;
}

export interface ApproveStockCountResult {
  readonly movementIds: readonly string[];
  readonly varianceCount: number;
  readonly status: string;
}

/**
 * Approves a count (`INV-004`, `DEC-017`): derives each counted line's variance
 * (`counted − expected`), posts **one `count_adjustment` movement per non-zero
 * variance** as a single atomic batch (`postStockMovements`, `sourceType
 * "stock_count"`, `sourceId` = count id, `occurredAt` = cutoff), records the
 * variances on the lines and marks the count `approved` with `approved_by/at`.
 *
 * Positive variances are valued at the caller's `unitCost` or the item's
 * `current_cost`; a positive variance with neither is rejected (the guard the
 * slice-9 test suite pins). Negative variances are valued by the domain at the
 * locked moving average, so the ledger stays consistent with `DEC-008`.
 *
 * The whole approval runs in one transaction: the postings, the line variances,
 * the header status and the audit fact commit or roll back together. A negative
 * variance that would drive a balance below zero still hits the `DEC-010` guard.
 *
 * A count-discovered waste is posted here as a `count_adjustment` **only**. The
 * waste slice must not also post a `waste` movement for the same event
 * (`WASTE-002`); the count's `sourceId` is the traceable origin.
 */
export async function approveStockCount(
  store: CountStore,
  input: ApproveStockCountInput,
): Promise<ApproveStockCountResult> {
  const suppliedUnitCost = input.unitCost ?? null;
  if (suppliedUnitCost !== null) {
    if (parseDecimal(suppliedUnitCost, MONEY_SCALE) < 0n) {
      throw new DomainError("unitCost must not be negative");
    }
  }
  const reasonCode = input.reasonCode ?? "count adjustment";

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

    const lines = await tx.listStockCountLines({
      organizationId: input.organizationId,
      stockCountId: count.id,
    });

    const movements: {
      locationId: string;
      storageAreaId: string;
      itemId: string;
      movementType: string;
      quantityDelta: string;
      unitCost?: string | null;
      lotId?: string | null;
      reasonCode?: string | null;
    }[] = [];
    const variances: { lineId: string; varianceQty: string }[] = [];

    for (const line of lines) {
      if (line.countedQty === null) {
        // An uncounted line carries no variance; it is left as-is.
        continue;
      }
      const variance =
        parseDecimal(line.countedQty, STOCK_QUANTITY_SCALE) -
        parseDecimal(line.expectedQty, STOCK_QUANTITY_SCALE);
      if (variance === 0n) {
        continue;
      }

      let unitCost: string | null = null;
      if (variance > 0n) {
        unitCost = suppliedUnitCost;
        if (unitCost === null) {
          const item = await tx.findCountItem(line.itemId);
          unitCost = item?.currentCost ?? null;
        }
        if (unitCost === null) {
          throw new DomainError("a positive count variance requires a unit cost");
        }
      }

      const quantityDelta = formatDecimal(variance, STOCK_QUANTITY_SCALE);
      movements.push({
        locationId: count.locationId,
        storageAreaId: line.storageAreaId,
        itemId: line.itemId,
        movementType: "count_adjustment",
        quantityDelta,
        unitCost,
        lotId: line.lotId,
        reasonCode,
      });
      variances.push({ lineId: line.id, varianceQty: quantityDelta });
    }

    // One atomic batch: a failure on any line rolls back every line and the
    // header update below.
    const results =
      movements.length === 0
        ? []
        : await postStockMovements(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            sourceType: "stock_count",
            sourceId: count.id,
            occurredAt: count.cutoff,
            movements,
          });

    for (const { lineId, varianceQty } of variances) {
      await tx.updateStockCountLine(lineId, { varianceQty });
    }

    const approvedAt = new Date().toISOString();
    const updated = await tx.updateStockCount(count.id, {
      status: "approved",
      approvedBy: input.actorId,
      approvedAt,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COUNTS_AUDIT_ACTIONS.countApproved,
      entityType: "stock_count",
      entityId: count.id,
      after: {
        variance_count: variances.length,
        movement_count: results.length,
        reason_code: reasonCode,
        approved_at: approvedAt,
      },
    });

    return {
      movementIds: results.map((result) => result.movementId),
      varianceCount: variances.length,
      status: updated.status,
    };
  });
}
