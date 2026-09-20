import type {
  CountStore,
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockCountLineView,
  StockCountSummary,
  StockLotRecord,
} from "@aquarela/application";
import { MONEY_SCALE, QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";
import { COUNT_STATUS } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the counts routes. Kept free
 * of Next, DB and I/O imports so it can be unit-tested directly; the routes do
 * the reads and hand the resolved reference records to the row mappers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_LINES = 500;

function readPositiveInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

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

/* ------------------------------- list query ------------------------------- */

export interface CountListQuery {
  readonly locationId?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedCountListQuery =
  { readonly ok: true; readonly query: CountListQuery } | { readonly ok: false };

const DEFAULT_LIMIT = 50;

/** Parses the optional location/status filters and `limit`/`offset` paging. */
export function parseCountListQuery(searchParams: URLSearchParams): ParsedCountListQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }

  const rawStatus = searchParams.get("status");
  let status: string | undefined;
  if (rawStatus !== null) {
    const value = rawStatus.trim();
    if (!COUNT_STATUS.includes(value as (typeof COUNT_STATUS)[number])) {
      return { ok: false };
    }
    status = value;
  }

  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }

  return {
    ok: true,
    query: {
      ...(locationId === undefined ? {} : { locationId }),
      ...(status === undefined ? {} : { status }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function readDecimal(body: Record<string, unknown>, key: string, scale: number): string | null {
  const raw = body[key];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    parseDecimal(raw.trim(), scale);
    return raw.trim();
  } catch {
    return null;
  }
}

export interface OpenCountInput {
  readonly locationId: string;
  readonly cutoff: string;
  readonly blind: boolean;
}

export type ParsedOpenCount =
  { readonly ok: true; readonly input: OpenCountInput } | { readonly ok: false };

/** `POST /` body: the location, the cutoff instant and the blind flag. */
export function parseOpenCountBody(body: Record<string, unknown> | undefined): ParsedOpenCount {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  if (locationId === null || !UUID.test(locationId)) {
    return { ok: false };
  }
  const cutoff = readText(body, "cutoff", 64);
  if (cutoff === null || !ISO_INSTANT.test(cutoff) || Number.isNaN(Date.parse(cutoff))) {
    return { ok: false };
  }
  const blindRaw = body.blind;
  if (blindRaw !== undefined && typeof blindRaw !== "boolean") {
    return { ok: false };
  }
  return { ok: true, input: { locationId, cutoff, blind: blindRaw === true } };
}

export interface CountedLineBody {
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  readonly countedQty: string;
  readonly reasonCode: string | null;
}

export type ParsedCountedBody =
  { readonly ok: true; readonly lines: readonly CountedLineBody[] } | { readonly ok: false };

/** `POST /[id]/counted` body: a non-empty list of observations. */
export function parseCountedBody(body: Record<string, unknown> | undefined): ParsedCountedBody {
  if (body === undefined || !Array.isArray(body.lines)) {
    return { ok: false };
  }
  if (body.lines.length === 0 || body.lines.length > MAX_LINES) {
    return { ok: false };
  }

  const lines: CountedLineBody[] = [];
  for (const raw of body.lines) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false };
    }
    const entry = raw as Record<string, unknown>;
    const itemId = readText(entry, "itemId", 64);
    const storageAreaId = readText(entry, "storageAreaId", 64);
    if (
      itemId === null ||
      storageAreaId === null ||
      !UUID.test(itemId) ||
      !UUID.test(storageAreaId)
    ) {
      return { ok: false };
    }
    const countedQty = readDecimal(entry, "countedQty", QUANTITY_SCALE);
    if (countedQty === null || parseDecimal(countedQty, QUANTITY_SCALE) < 0n) {
      return { ok: false };
    }
    const lotRaw = entry.lotId;
    let lotId: string | null = null;
    if (lotRaw !== undefined && lotRaw !== null) {
      if (typeof lotRaw !== "string" || !UUID.test(lotRaw.trim())) {
        return { ok: false };
      }
      lotId = lotRaw.trim();
    }
    const reasonCode =
      entry.reasonCode === undefined || entry.reasonCode === null
        ? null
        : readText(entry, "reasonCode", MAX_TEXT);
    if (entry.reasonCode !== undefined && entry.reasonCode !== null && reasonCode === null) {
      return { ok: false };
    }
    lines.push({ itemId, storageAreaId, lotId, countedQty, reasonCode });
  }
  return { ok: true, lines };
}

export interface ApproveCountInput {
  readonly unitCost: string | null;
  readonly reasonCode: string | null;
}

export type ParsedApproveBody =
  { readonly ok: true; readonly input: ApproveCountInput } | { readonly ok: false };

/** `POST /[id]/approve` body: an optional positive-variance unit cost and reason. */
export function parseApproveBody(body: Record<string, unknown> | undefined): ParsedApproveBody {
  if (body === undefined) {
    return { ok: false };
  }
  const unitCost =
    body.unitCost === undefined || body.unitCost === null
      ? null
      : readDecimal(body, "unitCost", MONEY_SCALE);
  if (body.unitCost !== undefined && body.unitCost !== null && unitCost === null) {
    return { ok: false };
  }
  if (unitCost !== null && parseDecimal(unitCost, MONEY_SCALE) < 0n) {
    return { ok: false };
  }
  const reasonCode =
    body.reasonCode === undefined || body.reasonCode === null
      ? null
      : readText(body, "reasonCode", MAX_TEXT);
  if (body.reasonCode !== undefined && body.reasonCode !== null && reasonCode === null) {
    return { ok: false };
  }
  return { ok: true, input: { unitCost, reasonCode } };
}

/* ------------------------------ response rows ----------------------------- */

export interface CountRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly cutoff: string;
  readonly status: string;
  readonly blind: boolean;
  readonly lineCount: number;
  readonly countedCount: number;
  readonly varianceCount: number | null;
  readonly createdAt: string;
  readonly approvedAt: string | null;
}

/** Maps count summaries to HTTP rows, dropping any foreign-organization row. */
export function toCountRows(
  organizationId: string,
  summaries: readonly StockCountSummary[],
  locations: ReadonlyMap<string, InventoryLocationRecord>,
): readonly CountRow[] {
  const rows: CountRow[] = [];
  for (const summary of summaries) {
    const count = summary.count;
    if (count.organizationId !== organizationId) {
      continue;
    }
    const location = locations.get(count.locationId);
    rows.push({
      id: count.id,
      locationId: count.locationId,
      locationCode: location?.organizationId === organizationId ? location.code : null,
      cutoff: count.cutoff,
      status: count.status,
      blind: count.blind,
      lineCount: summary.lineCount,
      countedCount: summary.countedCount,
      varianceCount: summary.varianceCount,
      createdAt: count.createdAt,
      approvedAt: count.approvedAt,
    });
  }
  return rows;
}

export interface CountRefs {
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
  readonly storageAreas: ReadonlyMap<string, InventoryStorageAreaRecord>;
  readonly lots: ReadonlyMap<string, StockLotRecord>;
}

export interface CountLineRow {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly storageAreaId: string;
  readonly storageAreaCode: string | null;
  readonly storageAreaName: string | null;
  readonly lotId: string | null;
  readonly lotNumber: string | null;
  readonly unitCode: string | null;
  readonly expectedQty: string | null;
  readonly countedQty: string | null;
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly recount: boolean;
}

function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function toMap<T extends { readonly id: string; readonly organizationId: string }>(
  records: readonly (T | undefined)[],
  organizationId: string,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (record !== undefined && record.organizationId === organizationId) {
      map.set(record.id, record);
    }
  }
  return map;
}

/**
 * Loads the display records a page of count lines needs, one query per distinct
 * id (never per row). Every record is org-checked before it is returned, so a
 * cross-organization reference resolves to nothing rather than leaking.
 */
export async function loadCountLineRefs(
  store: CountStore,
  organizationId: string,
  lines: readonly StockCountLineView[],
): Promise<CountRefs> {
  const itemIds = distinct(lines.map((line) => line.itemId));
  const areaIds = distinct(lines.map((line) => line.storageAreaId));
  const lotIds = distinct(lines.flatMap((line) => (line.lotId === null ? [] : [line.lotId])));

  const [items, storageAreas, lots] = await Promise.all([
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(areaIds.map((id) => store.findStorageArea(id))),
    Promise.all(lotIds.map((id) => store.findStockLot(id))),
  ]);

  const itemRecords = toMap(items, organizationId);
  const unitIds = distinct([...itemRecords.values()].map((item) => item.baseUnitId));
  const units = await Promise.all(unitIds.map((id) => store.findUnit(id)));

  return {
    items: itemRecords,
    units: toMap(units, organizationId),
    storageAreas: toMap(storageAreas, organizationId),
    lots: toMap(lots, organizationId),
  };
}

/** Maps blind-filtered count lines to HTTP rows with their unit-paired labels. */
export function toCountLineRows(
  organizationId: string,
  lines: readonly StockCountLineView[],
  refs: CountRefs,
): readonly CountLineRow[] {
  return lines.map((line) => {
    const item = refs.items.get(line.itemId);
    const area = refs.storageAreas.get(line.storageAreaId);
    const lot = line.lotId === null ? undefined : refs.lots.get(line.lotId);
    const unit = item === undefined ? undefined : refs.units.get(item.baseUnitId);
    const owned = item !== undefined && item.organizationId === organizationId ? item : undefined;
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: owned?.code ?? null,
      itemName: owned?.name ?? null,
      storageAreaId: line.storageAreaId,
      storageAreaCode: area?.code ?? null,
      storageAreaName: area?.name ?? null,
      lotId: line.lotId,
      lotNumber: lot?.lotNumber ?? null,
      unitCode: unit?.code ?? null,
      expectedQty: line.expectedQty,
      countedQty: line.countedQty,
      varianceQty: line.varianceQty,
      reasonCode: line.reasonCode,
      recount: line.recount,
    };
  });
}
