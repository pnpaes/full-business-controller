import { DomainError } from "@aquarela/domain";

import type { GoodsReceiptLineRecord, GoodsReceiptSummaryRecord, ReceivingStore } from "./types";

/**
 * Read services for recorded goods receipts (PROC-002 surfaces). They are thin
 * over the port so the route and the screens share one org-scoping contract, and
 * so they unit-test against `FakeReceivingStore` without a database.
 */

export const GOODS_RECEIPT_LIST_DEFAULT_LIMIT = 50;
export const GOODS_RECEIPT_LIST_MAX_LIMIT = 200;

export interface ListGoodsReceiptsInput {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly supplierId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

function requireOrganizationId(organizationId: string): string {
  if (organizationId.trim().length === 0) {
    throw new DomainError("organizationId is required");
  }
  return organizationId;
}

/** Bounds the page so one request cannot ask for the whole table. */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return GOODS_RECEIPT_LIST_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > GOODS_RECEIPT_LIST_MAX_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${GOODS_RECEIPT_LIST_MAX_LIMIT}`);
  }
  return limit;
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }
  return offset;
}

/** Receipts for one organization, newest first, with the derived gross total. */
export async function listGoodsReceipts(
  store: ReceivingStore,
  input: ListGoodsReceiptsInput,
): Promise<readonly GoodsReceiptSummaryRecord[]> {
  const organizationId = requireOrganizationId(input.organizationId);
  return store.listGoodsReceipts({
    organizationId,
    ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
    ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
    limit: normalizeLimit(input.limit),
    offset: normalizeOffset(input.offset),
  });
}

export interface GoodsReceiptDetail {
  readonly receipt: GoodsReceiptSummaryRecord;
  readonly lines: readonly GoodsReceiptLineRecord[];
}

/**
 * One receipt and its lines. A receipt from another organization is treated as
 * absent (the port has no org filter on the by-id read, so the caller checks the
 * record's `organizationId` here).
 */
export async function getGoodsReceipt(
  store: ReceivingStore,
  input: { readonly organizationId: string; readonly receiptId: string },
): Promise<GoodsReceiptDetail | undefined> {
  const organizationId = requireOrganizationId(input.organizationId);
  const receipt = await store.findGoodsReceipt(input.receiptId);
  if (receipt === undefined || receipt.organizationId !== organizationId) {
    return undefined;
  }
  const lines = await store.listGoodsReceiptLines(receipt.id);
  return { receipt, lines };
}
