import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  TransferDetail,
  TransferLineSummary,
  TransferMovementRecord,
  TransferSummary,
} from "@aquarela/application";
import { TRANSFER_STATUS } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the transfer routes. The
 * application commands remain the authority on the workflow, the vocabulary and
 * the transit rule; this module only validates shape and UUID-ness.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function readText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): string | null | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/**
 * An optional free-text field: absent, null or an empty/whitespace string all
 * mean "not supplied" (null); a wrong type or an over-long value is invalid.
 */
function readOptionalText(
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

/* ------------------------------ list query -------------------------------- */

export interface TransferListQuery {
  readonly status?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export type ParsedTransferListQuery =
  { readonly ok: true; readonly query: TransferListQuery } | { readonly ok: false };

function readInteger(searchParams: URLSearchParams, key: string): number | null | undefined {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

export function parseTransferListQuery(searchParams: URLSearchParams): ParsedTransferListQuery {
  const query: {
    status?: string;
    fromLocationId?: string;
    toLocationId?: string;
    limit?: number;
    offset?: number;
  } = {};

  const status = searchParams.get("status")?.trim();
  if (status !== undefined && status.length > 0) {
    if (!(TRANSFER_STATUS as readonly string[]).includes(status)) {
      return { ok: false };
    }
    query.status = status;
  }

  for (const key of ["fromLocationId", "toLocationId"] as const) {
    const value = searchParams.get(key)?.trim();
    if (value !== undefined && value.length > 0) {
      if (!isUuid(value)) {
        return { ok: false };
      }
      query[key] = value;
    }
  }

  const limit = readInteger(searchParams, "limit");
  if (limit === null) {
    return { ok: false };
  }
  if (limit !== undefined) {
    query.limit = limit;
  }
  const offset = readInteger(searchParams, "offset");
  if (offset === null) {
    return { ok: false };
  }
  if (offset !== undefined) {
    query.offset = offset;
  }

  return { ok: true, query };
}

/* ------------------------------ request body ------------------------------ */

export interface RequestTransferBody {
  readonly fromLocationId: string;
  readonly fromStorageAreaId: string;
  readonly toLocationId: string;
  readonly toStorageAreaId: string;
}

export type ParsedRequestTransfer =
  { readonly ok: true; readonly input: RequestTransferBody } | { readonly ok: false };

export function parseRequestTransferBody(
  body: Record<string, unknown> | undefined,
): ParsedRequestTransfer {
  if (body === undefined) {
    return { ok: false };
  }
  const fromLocationId = readText(body, "fromLocationId", 64);
  const fromStorageAreaId = readText(body, "fromStorageAreaId", 64);
  const toLocationId = readText(body, "toLocationId", 64);
  const toStorageAreaId = readText(body, "toStorageAreaId", 64);
  if (
    fromLocationId === null ||
    fromLocationId === undefined ||
    !isUuid(fromLocationId) ||
    fromStorageAreaId === null ||
    fromStorageAreaId === undefined ||
    !isUuid(fromStorageAreaId) ||
    toLocationId === null ||
    toLocationId === undefined ||
    !isUuid(toLocationId) ||
    toStorageAreaId === null ||
    toStorageAreaId === undefined ||
    !isUuid(toStorageAreaId)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    input: { fromLocationId, fromStorageAreaId, toLocationId, toStorageAreaId },
  };
}

/* ------------------------------ dispatch body ----------------------------- */

export interface TransferLineBody {
  readonly itemId: string;
  readonly quantity: string;
  readonly lotId: string | null;
}

export interface DispatchTransferBody {
  readonly lines: readonly TransferLineBody[];
  readonly occurredAt?: string;
  readonly allowNegativeOverride: boolean;
  readonly reasonCode: string | null;
}

export type ParsedDispatchTransfer =
  { readonly ok: true; readonly input: DispatchTransferBody } | { readonly ok: false };

function parseLines(value: unknown, allowEmpty = false): readonly TransferLineBody[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length === 0) {
    return allowEmpty ? [] : null;
  }
  const lines: TransferLineBody[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const line = raw as Record<string, unknown>;
    const itemId = readText(line, "itemId", 64);
    const quantity = readText(line, "quantity", 64);
    if (itemId === null || itemId === undefined || !isUuid(itemId) || quantity == null) {
      return null;
    }
    const lotId = line.lotId;
    if (lotId !== undefined && lotId !== null && (typeof lotId !== "string" || !isUuid(lotId))) {
      return null;
    }
    lines.push({ itemId, quantity, lotId: typeof lotId === "string" ? lotId : null });
  }
  return lines;
}

export function parseDispatchTransferBody(
  body: Record<string, unknown> | undefined,
): ParsedDispatchTransfer {
  if (body === undefined) {
    return { ok: false };
  }
  const lines = parseLines(body.lines);
  if (lines === null) {
    return { ok: false };
  }
  const override = body.allowNegativeOverride;
  if (override !== undefined && typeof override !== "boolean") {
    return { ok: false };
  }
  const occurredAt = readText(body, "occurredAt", 40);
  if (occurredAt === null) {
    return { ok: false };
  }
  const reasonCode = readOptionalText(body, "reasonCode", 200);
  if (!reasonCode.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      lines,
      allowNegativeOverride: override === true,
      reasonCode: reasonCode.value,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    },
  };
}

/* ------------------------------- receive body ----------------------------- */

export interface ReceiveTransferBody {
  readonly received: readonly TransferLineBody[];
  readonly occurredAt?: string;
  readonly discrepancyNote: string | null;
}

export type ParsedReceiveTransfer =
  { readonly ok: true; readonly input: ReceiveTransferBody } | { readonly ok: false };

export function parseReceiveTransferBody(
  body: Record<string, unknown> | undefined,
): ParsedReceiveTransfer {
  if (body === undefined) {
    return { ok: false };
  }
  const received = parseLines(body.received, true);
  if (received === null) {
    return { ok: false };
  }
  const occurredAt = readText(body, "occurredAt", 40);
  if (occurredAt === null) {
    return { ok: false };
  }
  const discrepancyNote = readOptionalText(body, "discrepancyNote");
  if (!discrepancyNote.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      received,
      discrepancyNote: discrepancyNote.value,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    },
  };
}

/* ------------------------------- cancel body ------------------------------ */

export type ParsedCancelTransfer =
  { readonly ok: true; readonly reasonCode: string | null } | { readonly ok: false };

export function parseCancelTransferBody(
  body: Record<string, unknown> | undefined,
): ParsedCancelTransfer {
  if (body === undefined) {
    return { ok: true, reasonCode: null };
  }
  const reasonCode = readOptionalText(body, "reasonCode", 200);
  if (!reasonCode.ok) {
    return { ok: false };
  }
  return { ok: true, reasonCode: reasonCode.value };
}

/* --------------------------------- mapping -------------------------------- */

export interface TransferRefs {
  readonly locations: ReadonlyMap<string, InventoryLocationRecord>;
  readonly storageAreas: ReadonlyMap<string, InventoryStorageAreaRecord>;
  readonly items: ReadonlyMap<string, InventoryItemRecord>;
  readonly units: ReadonlyMap<string, InventoryUnitRecord>;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

function areaLabel(area: InventoryStorageAreaRecord | undefined): string | null {
  return area === undefined ? null : `${area.code} · ${area.name}`;
}

export interface TransferRow {
  readonly id: string;
  readonly status: string;
  readonly fromLocationId: string;
  readonly fromLocationLabel: string | null;
  readonly fromStorageAreaLabel: string | null;
  readonly toLocationId: string;
  readonly toLocationLabel: string | null;
  readonly toStorageAreaLabel: string | null;
  readonly dispatchedAt: string | null;
  readonly receivedAt: string | null;
  readonly discrepancyNote: string | null;
  /** numeric(19,6), positive total. */
  readonly dispatchedQuantity: string;
  /** numeric(19,6), positive total. */
  readonly receivedQuantity: string;
  readonly hasDiscrepancy: boolean;
}

export function toTransferRows(
  organizationId: string,
  summaries: readonly TransferSummary[],
  refs: TransferRefs,
): readonly TransferRow[] {
  const rows: TransferRow[] = [];
  for (const summary of summaries) {
    const transfer = summary.transfer;
    if (transfer.organizationId !== organizationId) {
      continue;
    }
    const fromLocation = orgOwned(refs.locations.get(transfer.fromLocationId), organizationId);
    const toLocation = orgOwned(refs.locations.get(transfer.toLocationId), organizationId);
    const fromArea = orgOwned(refs.storageAreas.get(transfer.fromStorageAreaId), organizationId);
    const toArea = orgOwned(refs.storageAreas.get(transfer.toStorageAreaId), organizationId);
    rows.push({
      id: transfer.id,
      status: transfer.status,
      fromLocationId: transfer.fromLocationId,
      fromLocationLabel: fromLocation?.code ?? null,
      fromStorageAreaLabel: areaLabel(fromArea),
      toLocationId: transfer.toLocationId,
      toLocationLabel: toLocation?.code ?? null,
      toStorageAreaLabel: areaLabel(toArea),
      dispatchedAt: transfer.dispatchedAt,
      receivedAt: transfer.receivedAt,
      discrepancyNote: transfer.discrepancyNote,
      dispatchedQuantity: summary.dispatchedQuantity,
      receivedQuantity: summary.receivedQuantity,
      hasDiscrepancy: summary.hasDiscrepancy,
    });
  }
  return rows;
}

export interface TransferLineRow {
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly unitCode: string | null;
  readonly lotId: string | null;
  readonly dispatchedQuantity: string;
  readonly receivedQuantity: string;
  readonly unitCost: string | null;
  readonly hasDiscrepancy: boolean;
}

export function toTransferLineRows(
  organizationId: string,
  lines: readonly TransferLineSummary[],
  refs: TransferRefs,
): readonly TransferLineRow[] {
  return lines.map((line) => {
    const item = orgOwned(refs.items.get(line.itemId), organizationId);
    const unit = item === undefined ? undefined : refs.units.get(item.baseUnitId);
    return {
      itemId: line.itemId,
      itemCode: item?.code ?? null,
      itemName: item?.name ?? null,
      unitCode: unit?.code ?? null,
      lotId: line.lotId,
      dispatchedQuantity: line.dispatchedQuantity,
      receivedQuantity: line.receivedQuantity,
      unitCost: line.unitCost,
      hasDiscrepancy: line.hasDiscrepancy,
    };
  });
}

export interface TransferMovementRow {
  readonly id: string;
  readonly movementType: string;
  readonly occurredAt: string;
  readonly locationCode: string | null;
  readonly storageAreaCode: string | null;
  readonly itemCode: string | null;
  readonly quantityDelta: string;
  readonly unitCost: string | null;
  readonly valueDelta: string | null;
}

export function toTransferMovementRows(
  organizationId: string,
  movements: readonly TransferMovementRecord[],
  refs: TransferRefs,
): readonly TransferMovementRow[] {
  const rows: TransferMovementRow[] = [];
  for (const movement of movements) {
    if (movement.organizationId !== organizationId) {
      continue;
    }
    const location = orgOwned(refs.locations.get(movement.locationId), organizationId);
    const area = orgOwned(refs.storageAreas.get(movement.storageAreaId), organizationId);
    const item = orgOwned(refs.items.get(movement.itemId), organizationId);
    rows.push({
      id: movement.id,
      movementType: movement.movementType,
      occurredAt: movement.occurredAt,
      locationCode: location?.code ?? null,
      storageAreaCode: area?.code ?? null,
      itemCode: item?.code ?? null,
      quantityDelta: movement.quantityDelta,
      unitCost: movement.unitCost,
      valueDelta: movement.valueDelta,
    });
  }
  return rows;
}

export interface TransferDetailResponse {
  readonly transfer: TransferRow;
  readonly lines: readonly TransferLineRow[];
  readonly movements: readonly TransferMovementRow[];
}

/** Maps a detail read; the caller has already 404-ed an unknown transfer. */
export function toTransferDetailResponse(
  organizationId: string,
  detail: TransferDetail,
  refs: TransferRefs,
): TransferDetailResponse {
  return {
    transfer: toTransferRows(organizationId, [detail], refs)[0]!,
    lines: toTransferLineRows(organizationId, detail.lines, refs),
    movements: toTransferMovementRows(organizationId, detail.movements, refs),
  };
}
