import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockBalanceAsOfEntry,
  StockLotRecord,
} from "@aquarela/application";

/**
 * Pure query parsing and response mapping for `GET /api/v1/inventory/balances`.
 * Kept free of Next, DB and I/O imports so it can be unit-tested directly: the
 * route does the reads and hands the resolved reference records to
 * `toBalanceRows`.
 */

/** Narrow validation bounds the route accepts on the query string. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BalanceQuery {
  /** ISO-8601 instant cutoff; `asOf` defaults to the request time. */
  readonly asOf: string;
  readonly itemId?: string;
  readonly locationId?: string;
}

export type ParsedBalanceQuery =
  { readonly ok: true; readonly query: BalanceQuery } | { readonly ok: false };

/** `undefined` = absent (no filter), `"invalid"` = present but malformed. */
function readOptionalUuid(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && UUID.test(value) ? value : "invalid";
}

/**
 * Parses the optional `asOf`/`itemId`/`locationId` filters. `asOf` is only
 * shape-checked here (presence); the application's `getStockBalanceAsOf`
 * validates it as an ISO-8601 instant, so the ledger's contract stays the single
 * source of truth for that rule. A UUID filter that is present but malformed is
 * rejected up front because the store would otherwise pass it to Postgres.
 */
export function parseBalanceQuery(
  searchParams: URLSearchParams,
  now: Date = new Date(),
): ParsedBalanceQuery {
  const itemId = readOptionalUuid(searchParams, "itemId");
  const locationId = readOptionalUuid(searchParams, "locationId");
  if (itemId === "invalid" || locationId === "invalid") {
    return { ok: false };
  }
  const asOfRaw = searchParams.get("asOf");
  if (asOfRaw !== null && asOfRaw.trim().length === 0) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      asOf: asOfRaw === null ? now.toISOString() : asOfRaw.trim(),
      ...(itemId === undefined ? {} : { itemId }),
      ...(locationId === undefined ? {} : { locationId }),
    },
  };
}

/** The reference records the route loads for the balances in one response. */
export interface BalanceRefs {
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
  readonly locations: ReadonlyMap<string, InventoryLocationRecord>;
  readonly storageAreas: ReadonlyMap<string, InventoryStorageAreaRecord>;
  readonly lots: ReadonlyMap<string, StockLotRecord>;
}

/**
 * One balance group enriched with the identifiers (and the few display fields
 * the inventory port exposes) the UI needs. A missing or cross-organization
 * lookup yields `null` rather than a value: the surface never echoes another
 * tenant's data.
 */
export interface BalanceRow {
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly itemBaseUnitId: string | null;
  readonly itemBaseUnitCode: string | null;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly storageAreaId: string;
  readonly storageAreaCode: string | null;
  readonly storageAreaName: string | null;
  readonly lotId: string | null;
  readonly lotNumber: string | null;
  readonly quantityOnHand: string;
  readonly valueOnHand: string;
  readonly avgUnitCost: string | null;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

/**
 * Maps the application's as-of balances to the HTTP rows. A balance from another
 * organization is dropped outright (defence in depth on top of the store's
 * org-scoped aggregation), and every reference lookup is org-checked before its
 * fields are used.
 */
export function toBalanceRows(
  organizationId: string,
  balances: readonly StockBalanceAsOfEntry[],
  refs: BalanceRefs,
): readonly BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (const balance of balances) {
    if (balance.organizationId !== organizationId) {
      continue;
    }
    const item = orgOwned(refs.items.get(balance.itemId), organizationId);
    const unit =
      item === undefined ? undefined : orgOwned(refs.units.get(item.baseUnitId), organizationId);
    const location = orgOwned(refs.locations.get(balance.locationId), organizationId);
    const storageArea = orgOwned(refs.storageAreas.get(balance.storageAreaId), organizationId);
    const lot =
      balance.lotId === null ? undefined : orgOwned(refs.lots.get(balance.lotId), organizationId);

    rows.push({
      itemId: balance.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      itemBaseUnitId: item?.baseUnitId ?? null,
      itemBaseUnitCode: unit?.code ?? null,
      locationId: balance.locationId,
      locationCode: location?.code ?? null,
      storageAreaId: balance.storageAreaId,
      storageAreaCode: storageArea?.code ?? null,
      storageAreaName: storageArea?.name ?? null,
      lotId: balance.lotId,
      lotNumber: lot?.lotNumber ?? null,
      quantityOnHand: balance.quantityOnHand,
      valueOnHand: balance.valueOnHand,
      avgUnitCost: balance.avgUnitCost,
    });
  }
  return rows;
}
