import {
  DEFAULT_ITEMS_LIMIT,
  MAX_ITEMS_LIMIT,
  type CatalogItemRecord,
  type ConversionEdge,
  type ItemDetail,
  type SupplierItemDetail,
} from "@aquarela/application";

/**
 * Pure query parsing and response mapping for the Products read API. Kept free
 * of Next, DB and I/O imports so it can be unit-tested directly: the routes do
 * the reads and hand the application records to these mappers, which pick the
 * wire fields explicitly (no accidental field leakage) and normalise dates to
 * ISO strings.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export interface ItemsQuery {
  readonly search?: string;
  readonly itemType?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedItemsQuery =
  { readonly ok: true; readonly query: ItemsQuery } | { readonly ok: false };

function readOptionalText(searchParams: URLSearchParams, key: string): string | undefined {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** `undefined` = absent (default), `"invalid"` = present but not a valid integer. */
function readOptionalInt(
  searchParams: URLSearchParams,
  key: string,
): number | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number(value);
}

/**
 * Parses the optional `search`/`itemType`/`limit`/`offset` filters. Bounds match
 * the application service (`DEFAULT_ITEMS_LIMIT`/`MAX_ITEMS_LIMIT`); a malformed
 * value is rejected here so the route can answer 400 without touching the store.
 */
export function parseItemsQuery(searchParams: URLSearchParams): ParsedItemsQuery {
  const limit = readOptionalInt(searchParams, "limit");
  const offset = readOptionalInt(searchParams, "offset");
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  const resolvedLimit = limit ?? DEFAULT_ITEMS_LIMIT;
  const resolvedOffset = offset ?? 0;
  if (resolvedLimit < 1 || resolvedLimit > MAX_ITEMS_LIMIT) {
    return { ok: false };
  }
  const search = readOptionalText(searchParams, "search");
  const itemType = readOptionalText(searchParams, "itemType");
  return {
    ok: true,
    query: {
      ...(search === undefined ? {} : { search }),
      ...(itemType === undefined ? {} : { itemType }),
      limit: resolvedLimit,
      offset: resolvedOffset,
    },
  };
}

export interface ItemRow {
  readonly id: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
  readonly currentCost: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export function toItemRow(record: CatalogItemRecord): ItemRow {
  return {
    id: record.id,
    code: record.code,
    sku: record.sku,
    name: record.name,
    itemType: record.itemType,
    baseUnitId: record.baseUnitId,
    baseUnitCode: record.baseUnitCode,
    inventoryPolicy: record.inventoryPolicy,
    lotTracked: record.lotTracked,
    currentCost: record.currentCost,
    activeFrom: record.activeFrom,
    activeTo: record.activeTo,
  };
}

export interface SupplierPackRow {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly supplierSku: string;
  readonly packUnitId: string;
  readonly packUnitCode: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty: string | null;
  readonly leadTimeDays: number | null;
  readonly preferred: boolean;
}

export function toSupplierPackRow(record: SupplierItemDetail): SupplierPackRow {
  return {
    id: record.id,
    supplierId: record.supplierId,
    supplierCode: record.supplierCode,
    supplierName: record.supplierName,
    supplierSku: record.supplierSku,
    packUnitId: record.packUnitId,
    packUnitCode: record.packUnitCode,
    packToBaseUnitFactor: record.packToBaseUnitFactor,
    minOrderQty: record.minOrderQty,
    leadTimeDays: record.leadTimeDays,
    preferred: record.preferred,
  };
}

export interface ConversionRow {
  readonly fromUnitId: string;
  readonly fromUnitCode: string;
  readonly toUnitId: string;
  readonly toUnitCode: string;
  readonly factor: string;
  readonly itemId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function toConversionRow(edge: ConversionEdge): ConversionRow {
  return {
    fromUnitId: edge.fromUnit.id,
    fromUnitCode: edge.fromUnit.code,
    toUnitId: edge.toUnit.id,
    toUnitCode: edge.toUnit.code,
    factor: edge.factor,
    itemId: edge.itemId,
    effectiveFrom: edge.effectiveFrom.toISOString(),
    effectiveTo: edge.effectiveTo === null ? null : edge.effectiveTo.toISOString(),
  };
}

export interface ItemDetailResponse {
  readonly item: ItemRow;
  readonly supplierItems: readonly SupplierPackRow[];
  readonly conversions: readonly ConversionRow[];
}

export function toItemDetailResponse(detail: ItemDetail): ItemDetailResponse {
  return {
    item: toItemRow(detail.item),
    supplierItems: detail.supplierItems.map(toSupplierPackRow),
    conversions: detail.conversions.map(toConversionRow),
  };
}
