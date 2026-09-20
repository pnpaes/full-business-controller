import { DomainError, STOCK_QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import type {
  StockTransferPage,
  StockTransferRecord,
  TransferDetail,
  TransferLineSummary,
  TransferMovementRecord,
  TransferMovementSummary,
  TransferStore,
  TransferSummary,
} from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_TRANSFER_LIMIT = 50;
/** Hard ceiling so a caller cannot ask for an unbounded page. */
export const MAX_TRANSFER_LIMIT = 100;

/** A dispatched/received movement type; everything else (e.g. `revaluation`) is ignored. */
const DISPATCH_TYPE = "transfer_dispatch";
const RECEIPT_TYPE = "transfer_receipt";

/** The item/lot identity of a transfer line; an absent lot is its own bucket. */
function lineKeyOf(itemId: string, lotId: string | null): string {
  return `${itemId}\u0000${lotId ?? "\u0000null"}`;
}

interface LineAccumulator {
  readonly itemId: string;
  readonly lotId: string | null;
  dispatched: bigint;
  received: bigint;
  unitCost: string | null;
}

/**
 * Derives the per-item dispatched/received facts from a transfer's paired
 * movements (there is no transfer line table — `DEC-029`, recorded open point).
 * Only `transfer_dispatch` and `transfer_receipt` legs count; a `revaluation`
 * correction that the ledger may add for a residual is ignored.
 *
 * A line with no dispatch leg (received only) or no receipt leg (still in
 * transit, or lost) is a discrepancy, which is exactly what `INV-005` asks the
 * two-sided transfer to expose. The paired dispatch leg's applied average is
 * carried as the line's `unitCost`, so the receipt leg can be valued at it.
 */
export function summarizeTransferMovements(
  movements: readonly TransferMovementRecord[],
): TransferMovementSummary {
  const byLine = new Map<string, LineAccumulator>();

  for (const movement of movements) {
    const isDispatch = movement.movementType === DISPATCH_TYPE;
    const isReceipt = movement.movementType === RECEIPT_TYPE;
    if (!isDispatch && !isReceipt) {
      continue;
    }
    // Each leg-pair has a negative outbound and a positive inbound half; count
    // only the positive half so a paired transfer is not double-counted.
    const delta = parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE);
    if (delta <= 0n) {
      continue;
    }
    const key = lineKeyOf(movement.itemId, movement.lotId);
    let line = byLine.get(key);
    if (line === undefined) {
      line = {
        itemId: movement.itemId,
        lotId: movement.lotId,
        dispatched: 0n,
        received: 0n,
        unitCost: null,
      };
      byLine.set(key, line);
    }
    if (isDispatch) {
      line.dispatched += delta;
      line.unitCost ??= movement.unitCost;
    } else {
      line.received += delta;
    }
  }

  let dispatchedTotal = 0n;
  let receivedTotal = 0n;
  const lines: TransferLineSummary[] = [...byLine.values()]
    .sort((a, b) => {
      if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
      return (a.lotId ?? "") < (b.lotId ?? "") ? -1 : (a.lotId ?? "") > (b.lotId ?? "") ? 1 : 0;
    })
    .map((line) => {
      dispatchedTotal += line.dispatched;
      receivedTotal += line.received;
      return {
        itemId: line.itemId,
        lotId: line.lotId,
        dispatchedQuantity: formatDecimal(line.dispatched, STOCK_QUANTITY_SCALE),
        receivedQuantity: formatDecimal(line.received, STOCK_QUANTITY_SCALE),
        unitCost: line.unitCost,
        hasDiscrepancy: line.dispatched !== line.received,
      };
    });

  return {
    lines,
    dispatchedQuantity: formatDecimal(dispatchedTotal, STOCK_QUANTITY_SCALE),
    receivedQuantity: formatDecimal(receivedTotal, STOCK_QUANTITY_SCALE),
    hasDiscrepancy: lines.some((line) => line.hasDiscrepancy),
  };
}

async function summarize(
  store: TransferStore,
  organizationId: string,
  transfer: StockTransferRecord,
): Promise<TransferSummary> {
  const movements = await store.listStockMovementsByTransferId({
    organizationId,
    transferId: transfer.id,
  });
  return { transfer, ...summarizeTransferMovements(movements) };
}

export interface ListStockTransfersReadQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Transfers for one organization, newest first, each with its movement-derived
 * dispatched/received totals and discrepancy flag (`INV-005`). The page is
 * bounded and `hasMore` is derived by fetching one row past the page; the paired
 * movements are then read per transfer (there is no bulk pairing read in the
 * committed repository — recorded open point).
 */
export async function listStockTransfers(
  store: TransferStore,
  query: ListStockTransfersReadQuery,
): Promise<StockTransferPage> {
  const limit = query.limit ?? DEFAULT_TRANSFER_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRANSFER_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_TRANSFER_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listStockTransfers({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.fromLocationId === undefined ? {} : { fromLocationId: query.fromLocationId }),
    ...(query.toLocationId === undefined ? {} : { toLocationId: query.toLocationId }),
    limit: limit + 1,
    offset,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const transfers = await Promise.all(
    page.map((transfer) => summarize(store, query.organizationId, transfer)),
  );

  return { transfers, limit, offset, hasMore };
}

/**
 * One transfer plus its paired movements and derived per-line facts, or
 * `undefined` when it is unknown or owned by another organization. The caller
 * maps `undefined` to a 404.
 */
export async function getStockTransfer(
  store: TransferStore,
  query: { readonly organizationId: string; readonly transferId: string },
): Promise<TransferDetail | undefined> {
  const transfer = await store.findStockTransfer(query);
  if (transfer === undefined) {
    return undefined;
  }
  const movements = await store.listStockMovementsByTransferId(query);
  return { transfer, movements, ...summarizeTransferMovements(movements) };
}
