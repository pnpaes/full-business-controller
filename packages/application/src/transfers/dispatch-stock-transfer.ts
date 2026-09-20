import { DomainError, STOCK_QUANTITY_SCALE, formatDecimal } from "@aquarela/domain";

import { postStockMovements } from "../inventory";
import type {
  PostStockMovementResult,
  PostStockMovementsInput,
  StockBalanceKey,
} from "../inventory";
import { assertIsoInstant, isBlank } from "../inventory/validation";

import { TRANSFER_AUDIT_ACTIONS } from "./actions";
import { assertTransferStatus, loadStockTransfer } from "./state";
import { resolveTransitEndpoint } from "./transit";
import type { TransferStore } from "./types";
import { parsePositiveQuantity } from "./validation";

type DispatchMovement = PostStockMovementsInput["movements"][number];

export interface TransferDispatchLineInput {
  readonly itemId: string;
  /** numeric(19,6), positive magnitude; the command sets the sign. */
  readonly quantity: string;
  readonly lotId?: string | null;
}

export interface DispatchStockTransferInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly transferId: string;
  readonly lines: readonly TransferDispatchLineInput[];
  /** ISO instant; defaults to now. */
  readonly occurredAt?: string;
  readonly allowNegativeOverride?: boolean;
  readonly reasonCode?: string | null;
}

export interface DispatchStockTransferResult {
  readonly transferId: string;
  /** The first source-side leg; the full pair is read via `transfer_id`. */
  readonly dispatchMovementId: string;
  readonly movementIds: readonly string[];
}

/** The item/lot bucket a leg posts against. */
function balanceKey(
  organizationId: string,
  itemId: string,
  locationId: string,
  storageAreaId: string,
  lotId: string | null,
): StockBalanceKey {
  return { organizationId, itemId, locationId, storageAreaId, lotId };
}

/**
 * `approved` → `dispatched` (`INV-005`, `INV-009`, `DEC-029`). One atomic batch
 * posts, per line, the **source → transit** pair: a negative leg at the source
 * and a positive leg at the organization's in-transit holding point. Both legs
 * carry `transfer_id`, so a consolidation can eliminate the transit leg and
 * never double-count the goods.
 *
 * The outbound leg is valued automatically at the locked source average
 * (`unitCost: null`); the inbound leg is given that same average, read from the
 * locked source balance first, so the pair nets to zero value. The transit point
 * must already exist — the command fails clearly instead of creating one.
 */
export async function dispatchStockTransfer(
  store: TransferStore,
  input: DispatchStockTransferInput,
): Promise<DispatchStockTransferResult> {
  if (input.lines.length === 0) {
    throw new DomainError("a dispatch needs at least one line");
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  assertIsoInstant(occurredAt, "occurredAt");
  if (input.allowNegativeOverride === true && isBlank(input.reasonCode)) {
    throw new DomainError("allowNegativeOverride requires a reasonCode");
  }
  const reasonCode = isBlank(input.reasonCode) ? null : input.reasonCode!.trim();
  const lines = input.lines.map((line, index) => {
    const magnitude = parsePositiveQuantity(line.quantity, `lines[${index}].quantity`);
    return {
      itemId: line.itemId,
      lotId: line.lotId ?? null,
      magnitude,
    };
  });
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    // A repeated item/lot would post two pairs against the same balance; the
    // second pair could drift by the 4 dp average rounding. One line per bucket.
    const key = `${line.itemId}\u0000${line.lotId ?? ""}`;
    if (seen.has(key)) {
      throw new DomainError(`lines[${index}] duplicates an earlier item/lot line`);
    }
    seen.add(key);
  }

  return store.withTransaction(async (tx) => {
    const transfer = await loadStockTransfer(tx, input.organizationId, input.transferId);
    assertTransferStatus(transfer, ["approved"], "dispatch");

    const transit = await resolveTransitEndpoint(tx, input.organizationId);

    const movements: DispatchMovement[] = [];
    for (const [index, line] of lines.entries()) {
      const item = await tx.findItem(line.itemId);
      if (item === undefined || item.organizationId !== input.organizationId) {
        throw new DomainError(`lines[${index}].itemId not found in organization`);
      }
      if (item.inventoryPolicy !== "stocked") {
        throw new DomainError(`lines[${index}].itemId does not hold stock`);
      }

      // The source average is read under the same row lock the ledger post
      // takes, so the inbound leg's unit cost is exactly the outbound leg's
      // applied average and the source+transit pair nets to zero value.
      const source = await tx.lockStockBalance(
        balanceKey(
          input.organizationId,
          line.itemId,
          transfer.fromLocationId,
          transfer.fromStorageAreaId,
          line.lotId,
        ),
        new Date(occurredAt),
      );
      const outboundUnitCost = source.avgUnitCost ?? "0.0000";

      movements.push({
        locationId: transfer.fromLocationId,
        storageAreaId: transfer.fromStorageAreaId,
        itemId: line.itemId,
        movementType: "transfer_dispatch",
        quantityDelta: formatDecimal(-line.magnitude, STOCK_QUANTITY_SCALE),
        unitCost: null,
        lotId: line.lotId,
        reasonCode,
      });
      movements.push({
        locationId: transit.locationId,
        storageAreaId: transit.storageAreaId,
        itemId: line.itemId,
        movementType: "transfer_dispatch",
        quantityDelta: formatDecimal(line.magnitude, STOCK_QUANTITY_SCALE),
        unitCost: outboundUnitCost,
        lotId: line.lotId,
        reasonCode,
      });
    }

    const results: readonly PostStockMovementResult[] = await postStockMovements(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      sourceType: "transfer",
      sourceId: transfer.id,
      occurredAt,
      idempotencyKey: `transfer-dispatch-${transfer.id}`,
      movements,
      ...(input.allowNegativeOverride === true ? { allowNegativeOverride: true } : {}),
    });

    const dispatchMovementId = results[0]?.movementId;
    if (dispatchMovementId === undefined) {
      throw new DomainError("dispatch posted no movement");
    }

    await tx.updateStockTransfer({
      organizationId: input.organizationId,
      transferId: transfer.id,
      values: {
        status: "dispatched",
        dispatchedAt: occurredAt,
        dispatchMovementId,
      },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TRANSFER_AUDIT_ACTIONS.dispatched,
      entityType: "stock_transfer",
      entityId: transfer.id,
      before: { status: transfer.status },
      after: {
        status: "dispatched",
        dispatched_at: occurredAt,
        transit_location_id: transit.locationId,
        transit_storage_area_id: transit.storageAreaId,
        lines: lines.length,
        movement_ids: results.map((result) => result.movementId),
      },
    });

    return {
      transferId: transfer.id,
      dispatchMovementId,
      movementIds: results.map((result) => result.movementId),
    };
  });
}
