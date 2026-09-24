import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryUnitRecord,
  ProductionBatchCost,
  ProductionBatchInputRecord,
  ProductionBatchOutputRecord,
  ProductionBatchRecord,
  ProductionPlanRecord,
  ProductionRecipeRecord,
  ProductionRecipeVersionRecord,
  ProductionStore,
  StockLotRecord,
} from "@aquarela/application";
import { QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";
import { PRODUCTION_STATUS } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the production routes. Kept
 * free of Next, DB and I/O imports so it can be unit-tested directly; the routes
 * do the reads and hand the resolved reference records to the row mappers.
 *
 * Slice-10 open points that shape these helpers, recorded — not resolved:
 * (a) no batch number / natural key, so the create-batch body accepts an
 *     optional caller-supplied `productionBatchId` as the idempotency path;
 *     the plan is the same (`productionPlanId`);
 * (c) output cost allocation across multiple outputs is undefined, so a batch
 *     stays single-output and the completion body accepts exactly one output;
 * (e) no WIP/source-draw storage area, so the completion body must carry the
 *     draw area (`inputStorageAreaId`) and the seed/screen must supply it;
 * (f) `production_plan` has no status vocabulary authority (the
 *     `production_status` enum governs the batch), so plan `status` is accepted
 *     as free text and only batch status is checked against the vocabulary;
 * (g) no yield tolerance threshold, so `yieldVariancePct` is returned as a fact
 *     and no threshold is applied; a non-zero variance is recorded as a
 *     `yield_variance` `data_quality_exception` unconditionally (provisional);
 * (i) the planned input/output **lines** are only persisted at completion, so
 *     the batch-detail payload carries the header plus whatever lines exist and
 *     the screen resolves the planned snapshot from the recipe version.
 *
 * `DEC-036` partial-portion handling is unsupported here too (it has no column
 * anywhere): actual input/output quantities are base-unit decimals, and no
 * portion size is parsed, stored or invented.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_LINES = 200;

function isUuid(value: string): boolean {
  return UUID.test(value);
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

function readOptionalUuid(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && isUuid(value) ? value : "invalid";
}

function readOptionalQueryText(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_TEXT ? value : "invalid";
}

/** Optional ISO instant query value; absent/blank → undefined, malformed → "invalid". */
function readOptionalInstant(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)) ? value : "invalid";
}

/* ------------------------------- list query ------------------------------- */

export interface ProductionPlanListQuery {
  readonly locationId?: string;
  /** Free text: `production_plan.status` has no vocabulary authority (open point (f)). */
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedProductionPlanListQuery =
  { readonly ok: true; readonly query: ProductionPlanListQuery } | { readonly ok: false };

const DEFAULT_LIMIT = 50;

/** Parses the optional plan filters and `limit`/`offset` paging. */
export function parseProductionPlanListQuery(
  searchParams: URLSearchParams,
): ParsedProductionPlanListQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const status = readOptionalQueryText(searchParams, "status");
  if (status === "invalid") {
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
      ...(status === undefined ? {} : { status }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

export interface ProductionBatchListQuery {
  readonly locationId?: string;
  readonly status?: string;
  readonly planId?: string;
  readonly workstation?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedProductionBatchListQuery =
  { readonly ok: true; readonly query: ProductionBatchListQuery } | { readonly ok: false };

/** Parses the optional batch filters and `limit`/`offset` paging. */
export function parseProductionBatchListQuery(
  searchParams: URLSearchParams,
): ParsedProductionBatchListQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  const planId = readOptionalUuid(searchParams, "planId");
  if (locationId === "invalid" || planId === "invalid") {
    return { ok: false };
  }

  const workstation = readOptionalQueryText(searchParams, "workstation");
  if (workstation === "invalid") {
    return { ok: false };
  }

  const rawStatus = searchParams.get("status");
  let status: string | undefined;
  if (rawStatus !== null) {
    const value = rawStatus.trim();
    if (!(PRODUCTION_STATUS as readonly string[]).includes(value)) {
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
      ...(planId === undefined ? {} : { planId }),
      ...(workstation === undefined ? {} : { workstation }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

export interface ProductionBatchCostQuery {
  readonly costPoolId?: string;
  readonly periodFrom?: string;
  readonly periodTo?: string;
}

export type ParsedProductionBatchCostQuery =
  { readonly ok: true; readonly query: ProductionBatchCostQuery } | { readonly ok: false };

/**
 * `GET /batches/[id]/cost` query: the optional cost pool and allocation period.
 * All three are optional — without a pool the overhead is reported as zero.
 */
export function parseProductionBatchCostQuery(
  searchParams: URLSearchParams,
): ParsedProductionBatchCostQuery {
  const costPoolId = readOptionalUuid(searchParams, "costPoolId");
  const periodFrom = readOptionalInstant(searchParams, "periodFrom");
  const periodTo = readOptionalInstant(searchParams, "periodTo");
  if (costPoolId === "invalid" || periodFrom === "invalid" || periodTo === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(costPoolId === undefined ? {} : { costPoolId }),
      ...(periodFrom === undefined ? {} : { periodFrom }),
      ...(periodTo === undefined ? {} : { periodTo }),
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

/** Optional free text: absent/null/blank → null; wrong type or over-long → invalid. */
function readOptionalBodyText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || value.length > max) {
    return { ok: false };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

function readOptionalUuidBody(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length === 0
    ? { ok: true, value: null }
    : isUuid(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false };
}

function readDecimal(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false };
  }
  const trimmed = value.trim();
  try {
    parseDecimal(trimmed, QUANTITY_SCALE);
  } catch {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

export interface CreateProductionPlanBody {
  readonly locationId: string;
  readonly productionDate: string;
  /** Free text (open point (f)); null when not supplied. */
  readonly status: string | null;
  /** Optional deterministic id — the only idempotency path (open point (a)). */
  readonly productionPlanId: string | null;
}

export type ParsedCreateProductionPlan =
  { readonly ok: true; readonly input: CreateProductionPlanBody } | { readonly ok: false };

/** `POST /plans` body: location, production date and optional status/deterministic id. */
export function parseCreateProductionPlanBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateProductionPlan {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  if (locationId === null || !isUuid(locationId)) {
    return { ok: false };
  }
  const productionDate = readText(body, "productionDate", 32);
  if (productionDate === null || !ISO_DATE.test(productionDate)) {
    return { ok: false };
  }
  const status = readOptionalBodyText(body, "status");
  const productionPlanId = readOptionalUuidBody(body, "productionPlanId");
  if (!status.ok || !productionPlanId.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      locationId,
      productionDate,
      status: status.value,
      productionPlanId: productionPlanId.value,
    },
  };
}

export interface CreateProductionBatchBody {
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly planId: string | null;
  readonly workstation: string | null;
  readonly plannedStart: string | null;
  readonly operatorId: string | null;
  readonly destinationStorageAreaId: string | null;
  readonly productionBatchId: string | null;
}

export type ParsedCreateProductionBatch =
  { readonly ok: true; readonly input: CreateProductionBatchBody } | { readonly ok: false };

/** `POST /batches` body: the approved recipe version plus optional plan/workstation/areas. */
export function parseCreateProductionBatchBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateProductionBatch {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const recipeVersionId = readText(body, "recipeVersionId", 64);
  if (
    locationId === null ||
    !isUuid(locationId) ||
    recipeVersionId === null ||
    !isUuid(recipeVersionId)
  ) {
    return { ok: false };
  }

  const planId = readOptionalUuidBody(body, "planId");
  const operatorId = readOptionalUuidBody(body, "operatorId");
  const destinationStorageAreaId = readOptionalUuidBody(body, "destinationStorageAreaId");
  const productionBatchId = readOptionalUuidBody(body, "productionBatchId");
  const workstation = readOptionalBodyText(body, "workstation");
  if (
    !planId.ok ||
    !operatorId.ok ||
    !destinationStorageAreaId.ok ||
    !productionBatchId.ok ||
    !workstation.ok
  ) {
    return { ok: false };
  }

  const rawPlannedStart = body.plannedStart;
  let plannedStart: string | null = null;
  if (rawPlannedStart !== undefined && rawPlannedStart !== null) {
    if (
      typeof rawPlannedStart !== "string" ||
      !ISO_INSTANT.test(rawPlannedStart.trim()) ||
      Number.isNaN(Date.parse(rawPlannedStart.trim()))
    ) {
      return { ok: false };
    }
    plannedStart = rawPlannedStart.trim();
  }

  return {
    ok: true,
    input: {
      locationId,
      recipeVersionId,
      planId: planId.value,
      workstation: workstation.value,
      plannedStart,
      operatorId: operatorId.value,
      destinationStorageAreaId: destinationStorageAreaId.value,
      productionBatchId: productionBatchId.value,
    },
  };
}

export interface CompleteProductionBatchInputLineBody {
  readonly itemId: string;
  readonly actualQty: string;
  readonly lotId: string | null;
  readonly reasonCode: string | null;
}

export interface CompleteProductionBatchOutputBody {
  readonly itemId: string;
  readonly actualQty: string;
  readonly lotId: string | null;
  readonly expiryDate: string | null;
}

export interface CompleteProductionBatchBody {
  readonly actualFinish: string;
  readonly inputStorageAreaId: string | null;
  readonly inputs: readonly CompleteProductionBatchInputLineBody[];
  readonly output: CompleteProductionBatchOutputBody;
  readonly allowNegativeOverride: boolean;
  readonly idempotencyKey: string | null;
}

export type ParsedCompleteProductionBatch =
  { readonly ok: true; readonly input: CompleteProductionBatchBody } | { readonly ok: false };

/**
 * `POST /batches/[id]/complete` body: the actuals, the draw area and the output.
 * Shape/range only — the command re-checks approval, planned-line coverage,
 * non-zero-variance reasons, stock and the output item.
 */
export function parseCompleteProductionBatchBody(
  body: Record<string, unknown> | undefined,
): ParsedCompleteProductionBatch {
  if (body === undefined) {
    return { ok: false };
  }

  const actualFinish = readText(body, "actualFinish", 64);
  if (
    actualFinish === null ||
    !ISO_INSTANT.test(actualFinish) ||
    Number.isNaN(Date.parse(actualFinish))
  ) {
    return { ok: false };
  }

  const inputStorageAreaId = readOptionalUuidBody(body, "inputStorageAreaId");
  if (!inputStorageAreaId.ok) {
    return { ok: false };
  }

  if (!Array.isArray(body.inputs) || body.inputs.length > MAX_LINES) {
    return { ok: false };
  }
  const inputs: CompleteProductionBatchInputLineBody[] = [];
  for (const raw of body.inputs) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false };
    }
    const entry = raw as Record<string, unknown>;
    const itemId = readText(entry, "itemId", 64);
    const actualQty = readDecimal(entry, "actualQty");
    if (itemId === null || !isUuid(itemId) || !actualQty.ok) {
      return { ok: false };
    }
    if (parseDecimal(actualQty.value, QUANTITY_SCALE) < 0n) {
      return { ok: false };
    }
    const lotId = readOptionalUuidBody(entry, "lotId");
    const reasonCode = readOptionalBodyText(entry, "reasonCode");
    if (!lotId.ok || !reasonCode.ok) {
      return { ok: false };
    }
    inputs.push({
      itemId,
      actualQty: actualQty.value,
      lotId: lotId.value,
      reasonCode: reasonCode.value,
    });
  }

  if (body.output === null || typeof body.output !== "object" || Array.isArray(body.output)) {
    return { ok: false };
  }
  const outputEntry = body.output as Record<string, unknown>;
  const outputItemId = readText(outputEntry, "itemId", 64);
  const outputQty = readDecimal(outputEntry, "actualQty");
  if (outputItemId === null || !isUuid(outputItemId) || !outputQty.ok) {
    return { ok: false };
  }
  if (parseDecimal(outputQty.value, QUANTITY_SCALE) <= 0n) {
    return { ok: false };
  }
  const outputLotId = readOptionalUuidBody(outputEntry, "lotId");
  if (!outputLotId.ok) {
    return { ok: false };
  }
  const rawExpiry = outputEntry.expiryDate;
  let expiryDate: string | null = null;
  if (rawExpiry !== undefined && rawExpiry !== null) {
    if (typeof rawExpiry !== "string" || !ISO_DATE.test(rawExpiry.trim())) {
      return { ok: false };
    }
    expiryDate = rawExpiry.trim();
  }

  const rawOverride = body.allowNegativeOverride;
  if (rawOverride !== undefined && typeof rawOverride !== "boolean") {
    return { ok: false };
  }

  const idempotencyKey = readOptionalBodyText(body, "idempotencyKey");
  if (!idempotencyKey.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      actualFinish,
      inputStorageAreaId: inputStorageAreaId.value,
      inputs,
      output: {
        itemId: outputItemId,
        actualQty: outputQty.value,
        lotId: outputLotId.value,
        expiryDate,
      },
      allowNegativeOverride: rawOverride === true,
      idempotencyKey: idempotencyKey.value,
    },
  };
}

export type ParsedStartProductionBatch =
  { readonly ok: true; readonly actualStart: string | null } | { readonly ok: false };

/** `POST /batches/[id]/start` body: optional actual start (defaults to now server-side). */
export function parseStartProductionBatchBody(
  body: Record<string, unknown> | undefined,
): ParsedStartProductionBatch {
  const raw = body?.actualStart;
  if (raw === undefined || raw === null) {
    return { ok: true, actualStart: null };
  }
  if (
    typeof raw !== "string" ||
    !ISO_INSTANT.test(raw.trim()) ||
    Number.isNaN(Date.parse(raw.trim()))
  ) {
    return { ok: false };
  }
  return { ok: true, actualStart: raw.trim() };
}

export type ParsedCancelProductionBatch =
  { readonly ok: true; readonly reason: string | null } | { readonly ok: false };

/** `POST /batches/[id]/cancel` body: optional reason recorded on the audit fact. */
export function parseCancelProductionBatchBody(
  body: Record<string, unknown> | undefined,
): ParsedCancelProductionBatch {
  const reason = readOptionalBodyText(body ?? {}, "reason");
  return reason.ok ? { ok: true, reason: reason.value } : { ok: false };
}

/* ------------------------------ response rows ----------------------------- */

export interface ProductionPlanRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly productionDate: string;
  readonly status: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps plan headers to HTTP rows, dropping any foreign-organization row. */
export function toProductionPlanRows(
  organizationId: string,
  plans: readonly ProductionPlanRecord[],
  locations: ReadonlyMap<string, InventoryLocationRecord>,
): readonly ProductionPlanRow[] {
  const rows: ProductionPlanRow[] = [];
  for (const plan of plans) {
    if (plan.organizationId !== organizationId) {
      continue;
    }
    const location = locations.get(plan.locationId);
    const owned = location?.organizationId === organizationId ? location : undefined;
    rows.push({
      id: plan.id,
      locationId: plan.locationId,
      locationCode: owned?.code ?? null,
      locationName: owned?.name ?? null,
      productionDate: plan.productionDate,
      status: plan.status,
      createdAt: plan.createdAt,
      createdBy: plan.createdBy,
    });
  }
  return rows;
}

export interface ProductionBatchRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly workstation: string | null;
  readonly recipeVersionId: string;
  readonly recipeId: string | null;
  readonly recipeCode: string | null;
  readonly recipeName: string | null;
  readonly recipeVersionNo: number | null;
  readonly planId: string | null;
  readonly status: string;
  readonly plannedStart: string | null;
  readonly actualStart: string | null;
  readonly actualFinish: string | null;
  readonly destinationStorageAreaId: string | null;
  readonly plannedOutputQty: string | null;
  readonly actualOutputQty: string | null;
  /** numeric(9,6) signed fraction (not ×100). */
  readonly yieldVariancePct: string | null;
  readonly outputItemId: string | null;
  readonly outputItemCode: string | null;
  readonly outputItemName: string | null;
  readonly outputUnitCode: string | null;
  readonly createdAt: string;
}

/** Maps batch headers to HTTP rows with their location and recipe/output labels. */
export function toProductionBatchRows(
  organizationId: string,
  batches: readonly ProductionBatchRecord[],
  refs: ProductionRefs,
): readonly ProductionBatchRow[] {
  const rows: ProductionBatchRow[] = [];
  for (const batch of batches) {
    if (batch.organizationId !== organizationId) {
      continue;
    }
    const location = owned(refs.locations.get(batch.locationId), organizationId);
    const version = refs.recipeVersions.get(batch.recipeVersionId);
    const recipe =
      version === undefined ? undefined : owned(refs.recipes.get(version.recipeId), organizationId);
    const outputItemId = recipe?.outputItemId ?? null;
    const outputItem =
      outputItemId === null ? undefined : owned(refs.items.get(outputItemId), organizationId);
    const outputUnit = outputItem === undefined ? undefined : refs.units.get(outputItem.baseUnitId);
    rows.push({
      id: batch.id,
      locationId: batch.locationId,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      workstation: batch.workstation,
      recipeVersionId: batch.recipeVersionId,
      recipeId: recipe?.id ?? null,
      recipeCode: recipe?.code ?? null,
      recipeName: recipe?.name ?? null,
      recipeVersionNo: version?.versionNo ?? null,
      planId: batch.planId,
      status: batch.status,
      plannedStart: batch.plannedStart,
      actualStart: batch.actualStart,
      actualFinish: batch.actualFinish,
      destinationStorageAreaId: batch.destinationStorageAreaId,
      plannedOutputQty: batch.plannedOutputQty,
      actualOutputQty: batch.actualOutputQty,
      yieldVariancePct: batch.yieldVariancePct,
      outputItemId,
      outputItemCode: outputItem?.code ?? null,
      outputItemName: outputItem?.name ?? null,
      outputUnitCode: outputUnit?.code ?? null,
      createdAt: batch.createdAt,
    });
  }
  return rows;
}

export interface ProductionBatchInputRow {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly unitId: string;
  readonly unitCode: string | null;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  readonly lotNumber: string | null;
  readonly reasonCode: string | null;
  readonly movementId: string | null;
}

/** Maps persisted batch input lines to HTTP rows with item/unit/lot labels. */
export function toProductionBatchInputRows(
  organizationId: string,
  inputs: readonly ProductionBatchInputRecord[],
  refs: ProductionRefs,
): readonly ProductionBatchInputRow[] {
  return inputs.map((line) => {
    const item = owned(refs.items.get(line.itemId), organizationId);
    const unit = owned(refs.units.get(line.unitId), organizationId);
    const lot = line.lotId === null ? undefined : owned(refs.lots.get(line.lotId), organizationId);
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      unitId: line.unitId,
      unitCode: unit?.code ?? null,
      plannedQty: line.plannedQty,
      actualQty: line.actualQty,
      varianceQty: line.varianceQty,
      lotId: line.lotId,
      lotNumber: lot?.lotNumber ?? null,
      reasonCode: line.reasonCode,
      movementId: line.movementId,
    };
  });
}

export interface ProductionBatchOutputRow {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly unitId: string;
  readonly unitCode: string | null;
  readonly kind: string;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly movementId: string | null;
}

/** Maps persisted batch output lines to HTTP rows with item/unit/lot labels. */
export function toProductionBatchOutputRows(
  organizationId: string,
  outputs: readonly ProductionBatchOutputRecord[],
  refs: ProductionRefs,
): readonly ProductionBatchOutputRow[] {
  return outputs.map((line) => {
    const item = owned(refs.items.get(line.itemId), organizationId);
    const unit = owned(refs.units.get(line.unitId), organizationId);
    const lot = line.lotId === null ? undefined : owned(refs.lots.get(line.lotId), organizationId);
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      unitId: line.unitId,
      unitCode: unit?.code ?? null,
      kind: line.kind,
      plannedQty: line.plannedQty,
      actualQty: line.actualQty,
      varianceQty: line.varianceQty,
      lotId: line.lotId,
      lotNumber: lot?.lotNumber ?? null,
      expiryDate: line.expiryDate,
      movementId: line.movementId,
    };
  });
}

export interface ProductionBatchCostRow {
  readonly productionBatchId: string;
  readonly currency: string;
  /** All money values are canonical 4 dp strings (B-money / B2 / B3). */
  readonly ingredientCost: string;
  readonly labourCost: string;
  readonly allocatedOverhead: string;
  readonly totalBatchCost: string;
  /** numeric(19,6). */
  readonly actualOutputQty: string;
  readonly unitCost: string;
  readonly plannedOutputQty: string | null;
  /** numeric(9,6) signed fraction (not ×100). */
  readonly yieldVariancePct: string | null;
  readonly actualHours: string;
  readonly effectiveLoadedHourlyRate: string | null;
  readonly theoreticalUnitCost: string | null;
  readonly varianceUnitCost: string | null;
  readonly provenance: readonly string[];
}

/**
 * Maps the `DEC-124` batch cost to the HTTP row. It is a deliberate 1:1
 * projection — the query already returns only canonical decimals and
 * organization-scoped facts — kept as a named mapper so the route's response
 * contract is explicit and testable.
 */
export function toProductionBatchCostRow(cost: ProductionBatchCost): ProductionBatchCostRow {
  return {
    productionBatchId: cost.productionBatchId,
    currency: cost.currency,
    ingredientCost: cost.ingredientCost,
    labourCost: cost.labourCost,
    allocatedOverhead: cost.allocatedOverhead,
    totalBatchCost: cost.totalBatchCost,
    actualOutputQty: cost.actualOutputQty,
    unitCost: cost.unitCost,
    plannedOutputQty: cost.plannedOutputQty,
    yieldVariancePct: cost.yieldVariancePct,
    actualHours: cost.actualHours,
    effectiveLoadedHourlyRate: cost.effectiveLoadedHourlyRate,
    theoreticalUnitCost: cost.theoreticalUnitCost,
    varianceUnitCost: cost.varianceUnitCost,
    provenance: cost.provenance,
  };
}

/* --------------------------------- refs ----------------------------------- */

export interface ProductionRefs {
  readonly locations: ReadonlyMap<string, InventoryLocationRecord>;
  /** Recipe versions have no `organizationId`; their recipe is org-checked instead. */
  readonly recipeVersions: ReadonlyMap<string, ProductionRecipeVersionRecord>;
  readonly recipes: ReadonlyMap<string, ProductionRecipeRecord>;
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
  readonly lots: ReadonlyMap<string, StockLotRecord>;
}

export const EMPTY_PRODUCTION_REFS: ProductionRefs = {
  locations: new Map(),
  recipeVersions: new Map(),
  recipes: new Map(),
  items: new Map(),
  units: new Map(),
  lots: new Map(),
};

function owned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function toOwnedMap<T extends { readonly id: string; readonly organizationId: string }>(
  records: readonly (T | undefined)[],
  organizationId: string,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    const scoped = owned(record, organizationId);
    if (scoped !== undefined) {
      map.set(scoped.id, scoped);
    }
  }
  return map;
}

/**
 * Loads the display records a page of batches and their lines needs — one query
 * per distinct id, never per row. Every record is organization-checked before it
 * is returned, so a cross-organization reference resolves to null rather than
 * leaking. Recipe versions carry no `organizationId`, so the chain is verified
 * through their (org-checked) recipe.
 */
export async function loadProductionRefs(
  store: ProductionStore,
  organizationId: string,
  batches: readonly ProductionBatchRecord[],
  inputs: readonly ProductionBatchInputRecord[] = [],
  outputs: readonly ProductionBatchOutputRecord[] = [],
  /**
   * Extra item ids to resolve, for a screen that shows the **planned** snapshot
   * before any line rows exist (open point (i)) — e.g. the batch detail's
   * planned input items.
   */
  extraItemIds: readonly string[] = [],
): Promise<ProductionRefs> {
  const locationIds = distinct(batches.map((batch) => batch.locationId));
  const versionIds = distinct(batches.map((batch) => batch.recipeVersionId));
  const versions = await Promise.all(versionIds.map((id) => store.findRecipeVersion(id)));
  const recipeIds = distinct(
    versions.flatMap((version) => (version === undefined ? [] : [version.recipeId])),
  );
  const recipes = await Promise.all(recipeIds.map((id) => store.findRecipe(id)));
  const recipeMap = toOwnedMap(recipes, organizationId);

  const recipeVersions = new Map<string, ProductionRecipeVersionRecord>();
  for (const version of versions) {
    if (version !== undefined && recipeMap.has(version.recipeId)) {
      recipeVersions.set(version.id, version);
    }
  }

  const outputItemIds = [...recipeMap.values()].flatMap((recipe) =>
    recipe.outputItemId === null ? [] : [recipe.outputItemId],
  );
  const lineItemIds = [...inputs.map((line) => line.itemId), ...outputs.map((line) => line.itemId)];
  const items = await Promise.all(
    distinct([...outputItemIds, ...lineItemIds, ...extraItemIds]).map((id) => store.findItem(id)),
  );
  const itemMap = toOwnedMap(items, organizationId);

  const unitIds = distinct([
    ...[...itemMap.values()].map((item) => item.baseUnitId),
    ...inputs.map((line) => line.unitId),
    ...outputs.map((line) => line.unitId),
  ]);
  const units = await Promise.all(unitIds.map((id) => store.findUnit(id)));

  const lotIds = distinct(
    [...inputs.map((line) => line.lotId), ...outputs.map((line) => line.lotId)].flatMap((id) =>
      id === null ? [] : [id],
    ),
  );
  const lots = await Promise.all(lotIds.map((id) => store.findStockLot(id)));

  const locations = await Promise.all(locationIds.map((id) => store.findLocation(id)));

  return {
    locations: toOwnedMap(locations, organizationId),
    recipeVersions,
    recipes: recipeMap,
    items: itemMap,
    units: toOwnedMap(units, organizationId),
    lots: toOwnedMap(lots, organizationId),
  };
}
