import { applyStockMovementValue, type StockBalanceSnapshot } from "@aquarela/domain";

import { INVENTORY_AUDIT_ACTIONS } from "./actions";
import type { InventoryStore, StockBalanceKey } from "./types";

export interface PostRevaluationCorrectionInput {
  readonly key: StockBalanceKey;
  /** The balance immediately before the value-only correction. */
  readonly balance: StockBalanceSnapshot;
  /** The `revaluationGap` to clear (numeric(19,4), signed, non-zero). */
  readonly gap: string;
  readonly reasonCode: string;
  readonly sourceId: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly currency: string;
  readonly unitId: string;
  readonly lotId: string | null;
  /** Non-null for a reversal's correction; omitted from the audit when null. */
  readonly reversalOfId: string | null;
  readonly idempotencyKey: string | null;
}

/**
 * Posts the value-only `revaluation` movement that clears a cleanable residual
 * (zero quantity, non-zero value — DEC-028), saves the corrected balance and
 * writes the audit fact. Shared by the posting and reversal paths, which had
 * drifted; behaviour and audit payloads are preserved exactly. The caller owns
 * the idempotency key because the two paths use different schemes.
 */
export async function postRevaluationCorrection(
  tx: InventoryStore,
  input: PostRevaluationCorrectionInput,
): Promise<{ readonly movementId: string; readonly balance: StockBalanceSnapshot }> {
  const corrected = applyStockMovementValue(input.balance, {
    quantityDelta: "0.000000",
    valueDelta: input.gap,
  });
  const movement = await tx.createStockMovement({
    organizationId: input.key.organizationId,
    locationId: input.key.locationId,
    storageAreaId: input.key.storageAreaId,
    itemId: input.key.itemId,
    lotId: input.key.lotId,
    movementType: "revaluation",
    quantityDelta: "0.000000",
    unitId: input.unitId,
    unitCost: null,
    valueDelta: input.gap,
    currency: input.currency,
    sourceType: "revaluation",
    sourceId: input.sourceId,
    reversalOfId: null,
    occurredAt: input.occurredAt.toISOString(),
    postedBy: input.actorId,
    reasonCode: input.reasonCode,
    idempotencyKey: input.idempotencyKey,
  });
  await tx.saveStockBalance(input.key, {
    quantityOnHand: corrected.quantityOnHand,
    valueOnHand: corrected.valueOnHand,
    avgUnitCost: corrected.avgUnitCost,
    asOf: input.occurredAt,
  });
  await tx.writeAudit({
    organizationId: input.key.organizationId,
    actorId: input.actorId,
    action: INVENTORY_AUDIT_ACTIONS.revaluationPosted,
    entityType: "stock_movement",
    entityId: movement.id,
    after: {
      ...(input.reversalOfId !== null ? { reversal_of_id: input.reversalOfId } : {}),
      movement_type: "revaluation",
      quantity_delta: "0.000000",
      value_delta: input.gap,
      item_id: input.key.itemId,
      location_id: input.key.locationId,
      storage_area_id: input.key.storageAreaId,
      lot_id: input.key.lotId,
      source_type: "revaluation",
      source_id: input.sourceId,
      reason_code: input.reasonCode,
    },
  });
  return { movementId: movement.id, balance: corrected };
}
