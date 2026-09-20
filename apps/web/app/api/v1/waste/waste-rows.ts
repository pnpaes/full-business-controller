import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  WasteEventRecord,
  WasteProductVariantRecord,
} from "@aquarela/application";
import { QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";
import { WASTE_STAGE } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the waste routes. Kept free
 * of Next, DB and I/O imports so it can be unit-tested directly: the routes do
 * the reads and hand the resolved reference records to `toWasteEventRows`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_NOTE = 2000;

const WASTE_STAGES: readonly string[] = WASTE_STAGE;

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

export interface WasteQuery {
  readonly locationId?: string;
  readonly itemId?: string;
  readonly stage?: string;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedWasteQuery =
  { readonly ok: true; readonly query: WasteQuery } | { readonly ok: false };

const DEFAULT_LIMIT = 50;

/**
 * Parses the optional filters and paging for `GET /waste`. UUID filters and the
 * `stage` vocabulary are shape-checked here; the ISO window is only
 * presence-checked, because the application's `listWasteEvents` is the single
 * validator of an instant.
 */
export function parseWasteQuery(searchParams: URLSearchParams): ParsedWasteQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  const itemId = readOptionalUuid(searchParams, "itemId");
  if (locationId === "invalid" || itemId === "invalid") {
    return { ok: false };
  }

  const stageRaw = searchParams.get("stage");
  const stage = stageRaw === null ? undefined : stageRaw.trim();
  if (stage !== undefined && !WASTE_STAGES.includes(stage)) {
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
      ...(locationId === undefined ? {} : { locationId }),
      ...(itemId === undefined ? {} : { itemId }),
      ...(stage === undefined ? {} : { stage }),
      ...(occurredFrom === undefined ? {} : { occurredFrom }),
      ...(occurredTo === undefined ? {} : { occurredTo }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/* ------------------------------- post body -------------------------------- */

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): string | null | "invalid" {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length <= max ? trimmed : "invalid";
}

function readUuidValue(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return UUID.test(trimmed) ? trimmed : "invalid";
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

export interface RecordWasteBodyInput {
  readonly itemId: string | null;
  readonly productVariantId: string | null;
  readonly productionBatchId: string | null;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly quantity: string;
  readonly stage: string;
  readonly reasonCode: string;
  readonly occurredAt: string | null;
  readonly correctiveAction: string | null;
  readonly allowNegativeOverride: boolean;
  readonly idempotencyKey: string | null;
}

export type ParsedRecordWasteBody =
  { readonly ok: true; readonly input: RecordWasteBodyInput } | { readonly ok: false };

/**
 * Validates a record-waste body into the command's input shape. Vocabulary,
 * decimal scale, exactly-one-of item/variant, the ISO instant and the free-text
 * bounds are checked here; the command still enforces the economic rules
 * (positive quantity, stocked item, negative-stock guard).
 */
export function parseRecordWasteBody(
  body: Record<string, unknown> | undefined,
): ParsedRecordWasteBody {
  if (body === undefined) {
    return { ok: false };
  }

  const itemId = readUuidValue(body.itemId);
  const productVariantId = readUuidValue(body.productVariantId);
  const productionBatchId = readUuidValue(body.productionBatchId);
  if (
    itemId === "invalid" ||
    productVariantId === "invalid" ||
    productionBatchId === "invalid" ||
    (itemId === null) === (productVariantId === null)
  ) {
    return { ok: false };
  }

  const locationId = readText(body, "locationId", 64);
  const storageAreaId = readText(body, "storageAreaId", 64);
  if (
    locationId === null ||
    storageAreaId === null ||
    !UUID.test(locationId) ||
    !UUID.test(storageAreaId)
  ) {
    return { ok: false };
  }

  const quantity = readDecimal(body, "quantity", QUANTITY_SCALE);
  if (quantity === null || parseDecimal(quantity, QUANTITY_SCALE) <= 0n) {
    return { ok: false };
  }

  const stage = readText(body, "stage", 40);
  if (stage === null || !WASTE_STAGES.includes(stage)) {
    return { ok: false };
  }

  const reasonCode = readText(body, "reasonCode", MAX_TEXT);
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

  const correctiveAction = readOptionalText(body, "correctiveAction", MAX_NOTE);
  if (correctiveAction === "invalid") {
    return { ok: false };
  }

  const idempotencyKey =
    body.idempotencyKey === undefined || body.idempotencyKey === null
      ? null
      : readText(body, "idempotencyKey", MAX_TEXT);
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
      productVariantId,
      productionBatchId,
      locationId,
      storageAreaId,
      quantity,
      stage,
      reasonCode,
      occurredAt,
      correctiveAction,
      allowNegativeOverride: overrideRaw === true,
      idempotencyKey,
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface WasteRefs {
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
  readonly locations: ReadonlyMap<string, InventoryLocationRecord>;
  readonly storageAreas: ReadonlyMap<string, InventoryStorageAreaRecord>;
  readonly productVariants: ReadonlyMap<string, WasteProductVariantRecord>;
}

export interface WasteEventRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly itemId: string | null;
  readonly itemLabel: string | null;
  readonly productVariantId: string | null;
  readonly variantLabel: string | null;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly storageAreaId: string;
  readonly storageAreaCode: string | null;
  readonly storageAreaName: string | null;
  readonly quantity: string;
  readonly unitId: string;
  readonly unitCode: string | null;
  readonly stage: string;
  readonly reasonCode: string;
  readonly value: string | null;
  readonly currency: string | null;
  readonly correctiveAction: string | null;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

function label(
  record: { readonly code: string; readonly name: string } | undefined,
): string | null {
  if (record === undefined) {
    return null;
  }
  return `${record.code} · ${record.name}`;
}

/**
 * Maps waste events to HTTP rows. An event from another organization is dropped
 * outright (defence in depth on top of the org-scoped store read), and every
 * reference lookup is org-checked before its fields are used.
 */
export function toWasteEventRows(
  organizationId: string,
  events: readonly WasteEventRecord[],
  refs: WasteRefs,
): readonly WasteEventRow[] {
  const rows: WasteEventRow[] = [];
  for (const event of events) {
    if (event.organizationId !== organizationId) {
      continue;
    }
    const item =
      event.itemId === null ? undefined : orgOwned(refs.items.get(event.itemId), organizationId);
    const variant =
      event.productVariantId === null
        ? undefined
        : orgOwned(refs.productVariants.get(event.productVariantId), organizationId);
    const unit = orgOwned(refs.units.get(event.unitId), organizationId);
    const location = orgOwned(refs.locations.get(event.locationId), organizationId);
    const storageArea = orgOwned(refs.storageAreas.get(event.storageAreaId), organizationId);

    rows.push({
      id: event.id,
      occurredAt: event.occurredAt,
      itemId: event.itemId,
      itemLabel: label(item),
      productVariantId: event.productVariantId,
      variantLabel: label(variant),
      locationId: event.locationId,
      locationCode: location?.code ?? null,
      storageAreaId: event.storageAreaId,
      storageAreaCode: storageArea?.code ?? null,
      storageAreaName: storageArea?.name ?? null,
      quantity: event.quantity,
      unitId: event.unitId,
      unitCode: unit?.code ?? null,
      stage: event.stage,
      reasonCode: event.reasonCode,
      value: event.value,
      currency: event.currency,
      correctiveAction: event.correctiveAction,
    });
  }
  return rows;
}
