import { DomainError, STOCK_QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import { postStockMovements } from "../inventory";
import type {
  PostStockMovementResult,
  PostStockMovementsInput,
  StockBalanceKey,
} from "../inventory";
import { assertIsoInstant } from "../inventory/validation";

import { TRANSFER_AUDIT_ACTIONS } from "./actions";
import { assertTransferStatus, loadStockTransfer } from "./state";
import { resolveTransitEndpoint } from "./transit";
import type { TransferMovementRecord, TransferStore } from "./types";
import { parsePositiveQuantity } from "./validation";

type ReceiptMovement = PostStockMovementsInput["movements"][number];

/** The generated note's ceiling; a caller-supplied note is rejected above it. */
export const MAX_DISCREPANCY_NOTE_LENGTH = 2000;

export interface TransferReceiveLineInput {
  readonly itemId: string;
  /** numeric(19,6), positive magnitude; the command sets the sign. */
  readonly quantity: string;
  readonly lotId?: string | null;
}

export interface ReceiveStockTransferInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly transferId: string;
  readonly received: readonly TransferReceiveLineInput[];
  /** ISO instant; defaults to now. */
  readonly occurredAt?: string;
  readonly discrepancyNote?: string | null;
}

export interface ReceiveStockTransferResult {
  readonly transferId: string;
  /** The first transit-side leg; the full pair is read via `transfer_id`. */
  readonly receiptMovementId: string | null;
  readonly movementIds: readonly string[];
  readonly hasDiscrepancy: boolean;
  readonly discrepancyNote: string | null;
}

function lineKeyOf(itemId: string, lotId: string | null): string {
  return `${itemId}\u0000${lotId ?? "\u0000null"}`;
}

function balanceKey(
  organizationId: string,
  itemId: string,
  locationId: string,
  storageAreaId: string,
  lotId: string | null,
): StockBalanceKey {
  return { organizationId, itemId, locationId, storageAreaId, lotId };
}

/** A concise, deterministic record of what differed (no exception table exists). */
function generatedDiscrepancyNote(
  dispatch: ReadonlyMap<string, { readonly itemId: string; readonly quantity: bigint }>,
  received: ReadonlyMap<string, { readonly itemId: string; readonly quantity: bigint }>,
): string {
  const keys = new Set([...dispatch.keys(), ...received.keys()]);
  let differing = 0;
  for (const key of keys) {
    const expected = dispatch.get(key)?.quantity ?? 0n;
    const actual = received.get(key)?.quantity ?? 0n;
    if (expected !== actual) {
      differing += 1;
    }
  }
  return `Received quantity differs from dispatched on ${differing} of ${dispatch.size} line(s).`;
}

/**
 * `dispatched` → `received` (`INV-005`, `DEC-029`). One atomic batch posts, per
 * received line, the **transit → destination** pair: a negative leg at the
 * in-transit holding point and a positive leg at the destination. Both carry
 * `transfer_id`; the transit leg is eliminated in a consolidation.
 *
 * The transit outbound leg is valued at the locked transit average; the
 * destination inbound leg is given that same average, so the pair nets to zero
 * value. When the received quantity differs from the dispatched quantity (a
 * short or missing line), the header's `discrepancy_note` records it — there is
 * no exception table (recorded open point). The note is supplied or generated;
 * a supplied note is never dropped.
 */
export async function receiveStockTransfer(
  store: TransferStore,
  input: ReceiveStockTransferInput,
): Promise<ReceiveStockTransferResult> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  assertIsoInstant(occurredAt, "occurredAt");
  const suppliedNote = input.discrepancyNote?.trim() ?? "";
  if (suppliedNote.length > MAX_DISCREPANCY_NOTE_LENGTH) {
    throw new DomainError(
      `discrepancyNote must be at most ${MAX_DISCREPANCY_NOTE_LENGTH} characters`,
    );
  }

  const receivedLines = input.received.map((line, index) => {
    return {
      itemId: line.itemId,
      lotId: line.lotId ?? null,
      magnitude: parsePositiveQuantity(line.quantity, `received[${index}].quantity`),
    };
  });
  const receivedByLine = new Map<
    string,
    { itemId: string; lotId: string | null; quantity: bigint }
  >();
  for (const [index, line] of receivedLines.entries()) {
    const key = lineKeyOf(line.itemId, line.lotId);
    if (receivedByLine.has(key)) {
      throw new DomainError(`received[${index}] duplicates an earlier item/lot line`);
    }
    receivedByLine.set(key, { itemId: line.itemId, lotId: line.lotId, quantity: line.magnitude });
  }

  return store.withTransaction(async (tx) => {
    const transfer = await loadStockTransfer(tx, input.organizationId, input.transferId);
    assertTransferStatus(transfer, ["dispatched"], "receive");

    const transit = await resolveTransitEndpoint(tx, input.organizationId);
    const allMovements: readonly TransferMovementRecord[] = await tx.listStockMovementsByTransferId(
      {
        organizationId: input.organizationId,
        transferId: transfer.id,
      },
    );
    const dispatchByLine = new Map<string, { itemId: string; quantity: bigint }>();
    for (const movement of allMovements) {
      if (movement.movementType !== "transfer_dispatch") {
        continue;
      }
      // Only the positive (transit-side) leg carries the dispatched magnitude;
      // the source leg is its exact negation, so counting both would double it.
      const delta = parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE);
      if (delta <= 0n) {
        continue;
      }
      const key = lineKeyOf(movement.itemId, movement.lotId);
      const existing = dispatchByLine.get(key);
      dispatchByLine.set(key, {
        itemId: movement.itemId,
        quantity: (existing?.quantity ?? 0n) + delta,
      });
    }
    if (dispatchByLine.size === 0) {
      throw new DomainError("transfer has no dispatch movements to receive");
    }

    const hasDiscrepancy = [...new Set([...dispatchByLine.keys(), ...receivedByLine.keys()])].some(
      (key) => {
        const expected = dispatchByLine.get(key)?.quantity ?? 0n;
        const actual = receivedByLine.get(key)?.quantity ?? 0n;
        return expected !== actual;
      },
    );

    const movements: ReceiptMovement[] = [];
    for (const [key, line] of receivedByLine) {
      if (!dispatchByLine.has(key)) {
        throw new DomainError("received item/lot was not dispatched on this transfer");
      }
      // The transit average is read under the ledger's row lock, so the
      // destination inbound leg exactly offsets the transit outbound leg.
      const transitBalance = await tx.lockStockBalance(
        balanceKey(
          input.organizationId,
          line.itemId,
          transit.locationId,
          transit.storageAreaId,
          line.lotId,
        ),
        new Date(occurredAt),
      );
      const unitCost = transitBalance.avgUnitCost ?? "0.0000";

      movements.push({
        locationId: transit.locationId,
        storageAreaId: transit.storageAreaId,
        itemId: line.itemId,
        movementType: "transfer_receipt",
        quantityDelta: formatDecimal(-line.quantity, STOCK_QUANTITY_SCALE),
        unitCost: null,
        lotId: line.lotId,
        reasonCode: null,
      });
      movements.push({
        locationId: transfer.toLocationId,
        storageAreaId: transfer.toStorageAreaId,
        itemId: line.itemId,
        movementType: "transfer_receipt",
        quantityDelta: formatDecimal(line.quantity, STOCK_QUANTITY_SCALE),
        unitCost,
        lotId: line.lotId,
        reasonCode: null,
      });
    }

    let receiptMovementId: string | null = null;
    let movementIds: readonly string[] = [];
    if (movements.length > 0) {
      const results: readonly PostStockMovementResult[] = await postStockMovements(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        sourceType: "transfer",
        sourceId: transfer.id,
        occurredAt,
        idempotencyKey: `transfer-receipt-${transfer.id}`,
        movements,
      });
      receiptMovementId = results[0]?.movementId ?? null;
      movementIds = results.map((result) => result.movementId);
    }

    const discrepancyNote =
      suppliedNote.length > 0
        ? suppliedNote
        : hasDiscrepancy
          ? generatedDiscrepancyNote(dispatchByLine, receivedByLine)
          : null;

    await tx.updateStockTransfer({
      organizationId: input.organizationId,
      transferId: transfer.id,
      values: {
        status: "received",
        receivedAt: occurredAt,
        receiptMovementId,
        discrepancyNote,
      },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TRANSFER_AUDIT_ACTIONS.received,
      entityType: "stock_transfer",
      entityId: transfer.id,
      before: { status: transfer.status },
      after: {
        status: "received",
        received_at: occurredAt,
        lines: receivedByLine.size,
        has_discrepancy: hasDiscrepancy,
        discrepancy_note: discrepancyNote,
        movement_ids: movementIds,
      },
    });

    return {
      transferId: transfer.id,
      receiptMovementId,
      movementIds,
      hasDiscrepancy,
      discrepancyNote,
    };
  });
}
