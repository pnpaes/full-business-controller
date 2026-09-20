import {
  GOODS_RECEIPT_LIST_MAX_LIMIT,
  type GoodsReceiptLineRecord,
  type GoodsReceiptSummaryRecord,
  type ReceivingItem,
  type ReceivingLocationRecord,
  type ReceivingSupplierOption,
  type ReceivingUnit,
} from "@aquarela/application";

/**
 * Pure query parsing and response mapping for the receiving HTTP surface. Kept
 * free of Next, DB and I/O imports so the routes and the server screens both use
 * it (the balances pattern) and it can be unit-tested directly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------- list query ------------------------------- */

export interface ReceiptListQuery {
  readonly locationId?: string;
  readonly supplierId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export type ParsedReceiptListQuery =
  { readonly ok: true; readonly query: ReceiptListQuery } | { readonly ok: false };

/** `undefined` = absent, `"invalid"` = present but malformed. */
function readOptionalUuid(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return UUID.test(value) ? value : "invalid";
}

function readOptionalInteger(
  searchParams: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : "invalid";
}

/**
 * Parses `locationId`/`supplierId` (UUID) and `limit`/`offset`. A present but
 * malformed value is rejected up front so the store never receives junk. The
 * `limit` ceiling matches the application's own bound.
 */
export function parseReceiptListQuery(searchParams: URLSearchParams): ParsedReceiptListQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  const supplierId = readOptionalUuid(searchParams, "supplierId");
  const limit = readOptionalInteger(searchParams, "limit", 1, GOODS_RECEIPT_LIST_MAX_LIMIT);
  const offset = readOptionalInteger(searchParams, "offset", 0, Number.MAX_SAFE_INTEGER);
  if (
    locationId === "invalid" ||
    supplierId === "invalid" ||
    limit === "invalid" ||
    offset === "invalid"
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(locationId === undefined ? {} : { locationId }),
      ...(supplierId === undefined ? {} : { supplierId }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    },
  };
}

/* ------------------------------ response rows ------------------------------ */

/** The reference records the routes/screens load for one response. */
export interface ReceiptRefs {
  readonly suppliers: ReadonlyMap<string, ReceivingSupplierOption>;
  readonly locations: ReadonlyMap<string, ReceivingLocationRecord>;
  readonly items: ReadonlyMap<string, ReceivingItem>;
  readonly units: ReadonlyMap<string, ReceivingUnit>;
}

export interface ReceiptRow {
  readonly id: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly storeName: string | null;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly deliveryRef: string | null;
  readonly receivedAt: string;
  readonly status: string;
  readonly acceptedBy: string | null;
  readonly acceptedAt: string | null;
  /** numeric(19,4). */
  readonly grossTotal: string;
}

export interface ReceiptLineRow {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly supplierItemId: string | null;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly rejectedPackQty: string;
  readonly unitId: string;
  readonly unitCode: string | null;
  readonly packToBaseFactor: string;
  readonly price: string;
  readonly discount: string;
  readonly taxBasis: string;
  readonly allocatedFreight: string;
  readonly importFee: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly baseQtyAccepted: string;
  readonly landedBaseUnitCost: string;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

/**
 * Maps receipt summaries to HTTP rows. A receipt from another organization is
 * dropped, and every reference lookup is org-checked before its fields are used,
 * so the surface never echoes another tenant's data.
 */
export function toReceiptRows(
  organizationId: string,
  receipts: readonly GoodsReceiptSummaryRecord[],
  refs: ReceiptRefs,
): readonly ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const receipt of receipts) {
    if (receipt.organizationId !== organizationId) {
      continue;
    }
    const supplier =
      receipt.supplierId === null
        ? undefined
        : orgOwned(refs.suppliers.get(receipt.supplierId), organizationId);
    const location = orgOwned(refs.locations.get(receipt.locationId), organizationId);
    rows.push({
      id: receipt.id,
      supplierId: receipt.supplierId,
      supplierName: supplier?.name ?? null,
      storeName: receipt.storeName,
      locationId: receipt.locationId,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      deliveryRef: receipt.deliveryRef,
      receivedAt: receipt.receivedAt,
      status: receipt.status,
      acceptedBy: receipt.acceptedBy,
      acceptedAt: receipt.acceptedAt,
      grossTotal: receipt.grossTotal,
    });
  }
  return rows;
}

/** Maps one receipt's lines, enriching item and pack-unit display fields. */
export function toReceiptLineRows(
  organizationId: string,
  lines: readonly GoodsReceiptLineRecord[],
  refs: ReceiptRefs,
): readonly ReceiptLineRow[] {
  return lines.map((line) => {
    const item = orgOwned(refs.items.get(line.itemId), organizationId);
    const unit = orgOwned(refs.units.get(line.unitId), organizationId);
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      supplierItemId: line.supplierItemId,
      receivedPackQty: line.receivedPackQty,
      acceptedPackQty: line.acceptedPackQty,
      rejectedPackQty: line.rejectedPackQty,
      unitId: line.unitId,
      unitCode: unit?.code ?? null,
      packToBaseFactor: line.packToBaseFactor,
      price: line.price,
      discount: line.discount,
      taxBasis: line.taxBasis,
      allocatedFreight: line.allocatedFreight,
      importFee: line.importFee,
      lotNumber: line.lotNumber,
      expiryDate: line.expiryDate,
      baseQtyAccepted: line.baseQtyAccepted,
      landedBaseUnitCost: line.landedBaseUnitCost,
    };
  });
}
