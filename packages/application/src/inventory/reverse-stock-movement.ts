import {
  applyStockMovementValue,
  DomainError,
  reverseStockMovement as negateStockMovement,
  revaluationGap,
  type StockBalanceSnapshot,
} from "@aquarela/domain";

import { INVENTORY_AUDIT_ACTIONS } from "./actions";
import { resolveNegativeOverride } from "./permissions";
import { postRevaluationCorrection } from "./revaluation";
import type { InventoryStore, StockBalanceKey } from "./types";
import { assertIsoInstant, isBlank } from "./validation";

export interface ReverseStockMovementInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly movementId: string;
  readonly reasonCode: string;
  /** ISO timestamp; defaults to now. */
  readonly occurredAt?: string;
  readonly allowNegativeOverride?: boolean;
}

export interface ReverseStockMovementResult {
  readonly reversalMovementId: string;
  readonly revaluationMovementId: string | null;
  readonly quantityOnHand: string;
  readonly valueOnHand: string;
  readonly avgUnitCost: string | null;
}

/**
 * Reverses one posted movement (DEC-028): the offset is the exact negation of
 * the original quantity and value, never a repost at the current cost. When the
 * reversal leaves a cleanable residual (zero quantity, non-zero value) an
 * explicit `revaluation` movement clears it with the same reason, so the ledger
 * stays balanced at every cutoff.
 *
 * The reversal is idempotent by construction (`idempotencyKey = reversal:<id>`),
 * but a retry of an already-reversed movement is rejected rather than replayed —
 * the second call is a user error, not a transport retry.
 *
 * DEC-028's "automatic reversal is blocked when reconciled downstream sales
 * depend on the original" gate is deferred until the sales slice exposes
 * reconciliation state; today every reversal requires an explicit `reasonCode`.
 */
export async function reverseStockMovement(
  store: InventoryStore,
  input: ReverseStockMovementInput,
): Promise<ReverseStockMovementResult> {
  if (isBlank(input.reasonCode)) {
    throw new DomainError("reasonCode is required for a reversal");
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  assertIsoInstant(occurredAt, "occurredAt");

  return store.withTransaction(async (tx) => {
    const original = await tx.findStockMovement(input.movementId);
    if (original === undefined || original.organizationId !== input.organizationId) {
      throw new DomainError("movement not found in organization");
    }
    if (original.movementType === "revaluation") {
      throw new DomainError("a revaluation movement cannot be reversed");
    }
    const existingReversal = await tx.findStockMovementReversal(original.id);
    if (existingReversal !== undefined) {
      throw new DomainError("movement already reversed");
    }

    const offset = negateStockMovement({
      quantityDelta: original.quantityDelta,
      valueDelta: original.valueDelta ?? "0.0000",
    });
    const movementType = original.movementType === "receipt" ? "receipt_reversal" : "correction";

    const key: StockBalanceKey = {
      organizationId: original.organizationId,
      itemId: original.itemId,
      locationId: original.locationId,
      storageAreaId: original.storageAreaId,
      lotId: original.lotId,
    };
    const at = new Date(occurredAt);
    const current = await tx.lockStockBalance(key, at);
    const balance: StockBalanceSnapshot = {
      quantityOnHand: current.quantityOnHand,
      valueOnHand: current.valueOnHand,
      avgUnitCost: current.avgUnitCost,
    };

    const negativeOverride = await resolveNegativeOverride(tx, {
      quantityOnHand: balance.quantityOnHand,
      quantityDelta: offset.quantityDelta,
      allowNegativeOverride: input.allowNegativeOverride,
      actorId: input.actorId,
    });

    // The reversal mirrors the original's currency. A legacy movement with a
    // null currency falls back to its organization, which must exist.
    let currency = original.currency;
    if (currency === null) {
      const organization = await tx.findOrganization(original.organizationId);
      if (organization === undefined) {
        throw new DomainError("organization not found");
      }
      currency = organization.currency;
    }

    const restored = applyStockMovementValue(balance, offset);
    const reversal = await tx.createStockMovement({
      organizationId: original.organizationId,
      locationId: original.locationId,
      storageAreaId: original.storageAreaId,
      itemId: original.itemId,
      lotId: original.lotId,
      movementType,
      quantityDelta: offset.quantityDelta,
      unitId: original.unitId,
      unitCost: original.unitCost,
      valueDelta: offset.valueDelta,
      currency,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      reversalOfId: original.id,
      occurredAt,
      postedBy: input.actorId,
      reasonCode: input.reasonCode,
      idempotencyKey: `reversal:${original.id}`,
    });
    await tx.saveStockBalance(key, {
      quantityOnHand: restored.quantityOnHand,
      valueOnHand: restored.valueOnHand,
      avgUnitCost: restored.avgUnitCost,
      asOf: at,
    });
    await tx.writeAudit({
      organizationId: original.organizationId,
      actorId: input.actorId,
      action: INVENTORY_AUDIT_ACTIONS.stockMovementReversed,
      entityType: "stock_movement",
      entityId: reversal.id,
      after: {
        reversal_of_id: original.id,
        movement_type: movementType,
        quantity_delta: offset.quantityDelta,
        value_delta: offset.valueDelta,
        item_id: original.itemId,
        location_id: original.locationId,
        storage_area_id: original.storageAreaId,
        lot_id: original.lotId,
        source_type: original.sourceType,
        source_id: original.sourceId,
        reason_code: input.reasonCode,
        ...(negativeOverride ? { negative_override: true } : {}),
      },
    });

    let finalBalance = restored;
    let revaluationMovementId: string | null = null;
    const gap = revaluationGap(restored);
    if (gap !== null) {
      const correction = await postRevaluationCorrection(tx, {
        key,
        balance: restored,
        gap,
        reasonCode: input.reasonCode,
        sourceId: original.sourceId,
        occurredAt: at,
        actorId: input.actorId,
        currency,
        unitId: original.unitId,
        lotId: original.lotId,
        reversalOfId: original.id,
        idempotencyKey: `revaluation:${original.id}`,
      });
      finalBalance = correction.balance;
      revaluationMovementId = correction.movementId;
    }

    return {
      reversalMovementId: reversal.id,
      revaluationMovementId,
      quantityOnHand: finalBalance.quantityOnHand,
      valueOnHand: finalBalance.valueOnHand,
      avgUnitCost: finalBalance.avgUnitCost,
    };
  });
}
