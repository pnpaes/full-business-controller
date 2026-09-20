import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockLotRecord,
  StockMovementRecord,
} from "@aquarela/application";
import { MONEY_SCALE, QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";

/**
 * Pure query/body parsing and response mapping for the inventory movement
 * routes. Kept free of Next, DB and I/O imports so it can be unit-tested
 * directly; the route does the reads and hands the resolved reference records to
 * `toMovementRows`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;

/**
 * Movement types a human may post by hand in this slice. Receipt/production/
 * sales/transfer types belong to their own slices; the manual form is exactly
 * the adjustment/waste surface (08_UI_UX.md §8.3, §8.6).
 */
export const MANUAL_MOVEMENT_TYPES = ["count_adjustment", "correction", "waste"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

/**
 * The `stock_movement.source_type` for a manual movement. There is no upstream
 * document, so the source is the operator's own adjustment or waste event and
 * the route generates the `sourceId`.
 */
export function manualSourceType(movementType: ManualMovementType): string {
  return movementType === "waste" ? "waste_event" : "adjustment";
}

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

/** `undefined` = absent; `null` = the explicit "no lot" selector; `"invalid"` otherwise. */
function readLotFilter(searchParams: URLSearchParams): string | null | undefined | "invalid" {
  const raw = searchParams.get("lotId");
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (value === "none") {
    return null;
  }
  return UUID.test(value) ? value : "invalid";
}

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

export interface MovementQuery {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string;
  /** `null` = only no-lot movements; absent = no filter. */
  readonly lotId?: string | null;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedMovementQuery =
  { readonly ok: true; readonly query: MovementQuery } | { readonly ok: false };

const DEFAULT_LIMIT = 50;

/**
 * Parses the optional filters and paging for `GET /movements`. UUID filters are
 * shape-checked here; the ISO window is only presence-checked, because the
 * application's `listStockMovements` is the single validator of an instant.
 */
export function parseMovementQuery(searchParams: URLSearchParams): ParsedMovementQuery {
  const itemId = readOptionalUuid(searchParams, "itemId");
  const locationId = readOptionalUuid(searchParams, "locationId");
  const storageAreaId = readOptionalUuid(searchParams, "storageAreaId");
  const lotId = readLotFilter(searchParams);
  if (
    itemId === "invalid" ||
    locationId === "invalid" ||
    storageAreaId === "invalid" ||
    lotId === "invalid"
  ) {
    return { ok: false };
  }

  const occurredFrom = readOptionalInstant(searchParams, "from");
  const occurredTo = readOptionalInstant(searchParams, "to");
  if (occurredFrom === "invalid" || occurredTo === "invalid") {
    return { ok: false };
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
      ...(itemId === undefined ? {} : { itemId }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(storageAreaId === undefined ? {} : { storageAreaId }),
      ...(lotId === undefined ? {} : { lotId }),
      ...(occurredFrom === undefined ? {} : { occurredFrom: occurredFrom.trim() }),
      ...(occurredTo === undefined ? {} : { occurredTo: occurredTo.trim() }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

function readOptionalInstant(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)) ? value : "invalid";
}

/* ------------------------------- post body -------------------------------- */

export interface PostMovementInput {
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly movementType: ManualMovementType;
  readonly sourceType: string;
  readonly quantityDelta: string;
  readonly unitCost: string | null;
  readonly occurredAt: string | null;
  readonly lotId: string | null;
  readonly reasonCode: string;
  readonly idempotencyKey: string | null;
  readonly allowNegativeOverride: boolean;
}

export type ParsedPostMovement =
  { readonly ok: true; readonly input: PostMovementInput } | { readonly ok: false };

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** A signed decimal at the given scale, or null when it is malformed. */
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

/**
 * Validates a manual movement body into the command's input shape. Vocabulary,
 * decimal scale, reason presence and the ISO instant are checked here; the
 * command still enforces the economic rules (non-zero, inbound cost, the
 * negative-stock guard and the DEC-010 manager gate). `waste` must be negative:
 * a waste movement that adds stock is a contradiction, not a correction.
 */
export function parsePostMovementBody(
  body: Record<string, unknown> | undefined,
): ParsedPostMovement {
  if (body === undefined) {
    return { ok: false };
  }
  const itemId = readText(body, "itemId", 64);
  const locationId = readText(body, "locationId", 64);
  const storageAreaId = readText(body, "storageAreaId", 64);
  if (
    itemId === null ||
    locationId === null ||
    storageAreaId === null ||
    !UUID.test(itemId) ||
    !UUID.test(locationId) ||
    !UUID.test(storageAreaId)
  ) {
    return { ok: false };
  }

  const movementType = readText(body, "movementType", 40);
  if (
    movementType === null ||
    !MANUAL_MOVEMENT_TYPES.includes(movementType as ManualMovementType)
  ) {
    return { ok: false };
  }
  const typed = movementType as ManualMovementType;

  const quantityDelta = readDecimal(body, "quantityDelta", QUANTITY_SCALE);
  if (quantityDelta === null || parseDecimal(quantityDelta, QUANTITY_SCALE) === 0n) {
    return { ok: false };
  }
  if (typed === "waste" && parseDecimal(quantityDelta, QUANTITY_SCALE) > 0n) {
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

  const reasonCode = readText(body, "reasonCode", 200);
  if (reasonCode === null) {
    return { ok: false };
  }

  const occurredAtRaw = body.occurredAt;
  let occurredAt: string | null = null;
  if (occurredAtRaw !== undefined && occurredAtRaw !== null) {
    if (
      typeof occurredAtRaw !== "string" ||
      !ISO_INSTANT.test(occurredAtRaw.trim()) ||
      Number.isNaN(Date.parse(occurredAtRaw.trim()))
    ) {
      return { ok: false };
    }
    occurredAt = occurredAtRaw.trim();
  }

  const lotIdRaw = body.lotId;
  let lotId: string | null = null;
  if (lotIdRaw !== undefined && lotIdRaw !== null) {
    if (typeof lotIdRaw !== "string" || !UUID.test(lotIdRaw.trim())) {
      return { ok: false };
    }
    lotId = lotIdRaw.trim();
  }

  const idempotencyKey =
    body.idempotencyKey === undefined || body.idempotencyKey === null
      ? null
      : readText(body, "idempotencyKey", 200);
  if (idempotencyKey !== null && idempotencyKey.includes(":")) {
    return { ok: false };
  }

  const overrideRaw = body.allowNegativeOverride;
  if (overrideRaw !== undefined && typeof overrideRaw !== "boolean") {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      itemId,
      locationId,
      storageAreaId,
      movementType: typed,
      sourceType: manualSourceType(typed),
      quantityDelta,
      unitCost,
      occurredAt,
      lotId,
      reasonCode,
      idempotencyKey,
      allowNegativeOverride: overrideRaw === true,
    },
  };
}

export type ParsedReverseBody =
  | { readonly ok: true; readonly reasonCode: string; readonly allowNegativeOverride: boolean }
  | { readonly ok: false };

/** A reversal body: a non-blank reason is mandatory; the override is optional. */
export function parseReverseBody(body: Record<string, unknown> | undefined): ParsedReverseBody {
  if (body === undefined) {
    return { ok: false };
  }
  const reasonCode = readText(body, "reasonCode", 200);
  if (reasonCode === null) {
    return { ok: false };
  }
  const overrideRaw = body.allowNegativeOverride;
  if (overrideRaw !== undefined && typeof overrideRaw !== "boolean") {
    return { ok: false };
  }
  return { ok: true, reasonCode, allowNegativeOverride: overrideRaw === true };
}

/* ------------------------------ response rows ----------------------------- */

/** The reference records a movement page needs, loaded once per distinct id. */
export interface MovementRefs {
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
  readonly locations: ReadonlyMap<string, InventoryLocationRecord>;
  readonly storageAreas: ReadonlyMap<string, InventoryStorageAreaRecord>;
  readonly lots: ReadonlyMap<string, StockLotRecord>;
}

export interface MovementRow {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly storageAreaId: string;
  readonly storageAreaCode: string | null;
  readonly storageAreaName: string | null;
  readonly lotId: string | null;
  readonly lotNumber: string | null;
  readonly movementType: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly quantityDelta: string;
  readonly unitId: string;
  readonly unitCode: string | null;
  readonly unitCost: string | null;
  readonly valueDelta: string | null;
  readonly currency: string | null;
  readonly occurredAt: string;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly reasonCode: string | null;
  readonly reversalOfId: string | null;
  /** True when a reversal movement exists against this row. */
  readonly reversed: boolean;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

/**
 * Maps ledger movements to HTTP rows. A movement from another organization is
 * dropped outright (defence in depth on top of the org-scoped store read), and
 * every reference lookup is org-checked before its fields are used.
 */
export function toMovementRows(
  organizationId: string,
  movements: readonly StockMovementRecord[],
  refs: MovementRefs,
  reversedIds: ReadonlySet<string> = new Set(),
): readonly MovementRow[] {
  const rows: MovementRow[] = [];
  for (const movement of movements) {
    if (movement.organizationId !== organizationId) {
      continue;
    }
    const item = orgOwned(refs.items.get(movement.itemId), organizationId);
    const unit = orgOwned(refs.units.get(movement.unitId), organizationId);
    const location = orgOwned(refs.locations.get(movement.locationId), organizationId);
    const storageArea = orgOwned(refs.storageAreas.get(movement.storageAreaId), organizationId);
    const lot =
      movement.lotId === null ? undefined : orgOwned(refs.lots.get(movement.lotId), organizationId);

    rows.push({
      id: movement.id,
      itemId: movement.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      locationId: movement.locationId,
      locationCode: location?.code ?? null,
      storageAreaId: movement.storageAreaId,
      storageAreaCode: storageArea?.code ?? null,
      storageAreaName: storageArea?.name ?? null,
      lotId: movement.lotId,
      lotNumber: lot?.lotNumber ?? null,
      movementType: movement.movementType,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      quantityDelta: movement.quantityDelta,
      unitId: movement.unitId,
      unitCode: unit?.code ?? null,
      unitCost: movement.unitCost,
      valueDelta: movement.valueDelta,
      currency: movement.currency,
      occurredAt: movement.occurredAt,
      postedAt: movement.postedAt,
      postedBy: movement.postedBy,
      reasonCode: movement.reasonCode,
      reversalOfId: movement.reversalOfId,
      reversed: reversedIds.has(movement.id),
    });
  }
  return rows;
}
