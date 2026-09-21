import type { MonitoringPointRecord, MonitoringReadingRecord } from "@aquarela/application";

/**
 * Pure query/body parsing and response mapping for the HMS monitoring routes
 * (`HMS-002`, `DEC-089`). Kept free of Next, DB and I/O imports so the routes do
 * the reads and hand the application results to the row mappers.
 *
 * The parsers do shape checks only (required text, UUIDs, bounded paging,
 * `activeOnly`): the `kind`/`checkFrequency` vocabulary and the decimal target
 * range are the application command's authority and surface as a `DomainError`
 * (400) with a readable message. The row mappers drop a foreign-organization row
 * defensively, like the other slices, even though the application reads are
 * already organization-scoped (`DEC-061`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_TEXT = 200;
const MAX_NOTES = 2000;

export function isUuid(value: string): boolean {
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

function readOptionalQueryBoolean(
  searchParams: URLSearchParams,
  key: string,
): boolean | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return "invalid";
}

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

/** Optional uuid: absent/null/blank → null; a non-uuid string → invalid. */
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

/* --------------------------------- queries -------------------------------- */

export interface MonitoringPointListQuery {
  readonly locationId?: string;
  readonly activeOnly?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedMonitoringPointListQuery =
  { readonly ok: true; readonly query: MonitoringPointListQuery } | { readonly ok: false };

/** Parses the optional `locationId`/`activeOnly` filters and `limit`/`offset` paging. */
export function parseMonitoringPointListQuery(
  searchParams: URLSearchParams,
): ParsedMonitoringPointListQuery {
  const rawLocationId = searchParams.get("locationId");
  let locationId: string | undefined;
  if (rawLocationId !== null) {
    const value = rawLocationId.trim();
    if (!isUuid(value)) {
      return { ok: false };
    }
    locationId = value;
  }

  const activeOnly = readOptionalQueryBoolean(searchParams, "activeOnly");
  if (activeOnly === "invalid") {
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
      ...(activeOnly === undefined ? {} : { activeOnly }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

export interface MonitoringReadingListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedMonitoringReadingListQuery =
  { readonly ok: true; readonly query: MonitoringReadingListQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` paging of a point's reading page (newest first). */
export function parseMonitoringReadingListQuery(
  searchParams: URLSearchParams,
): ParsedMonitoringReadingListQuery {
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  return { ok: true, query: { limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 } };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateMonitoringPointBody {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly unit: string;
  readonly targetMin: string;
  readonly targetMax: string;
  readonly checkFrequency: string;
  readonly locationId: string;
  readonly storageAreaId: string | null;
}

export type ParsedCreateMonitoringPoint =
  { readonly ok: true; readonly input: CreateMonitoringPointBody } | { readonly ok: false };

/** `POST /monitoring-points` body: the point's identity, targets and location. */
export function parseCreateMonitoringPointBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateMonitoringPoint {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code");
  const name = readText(body, "name");
  const kind = readText(body, "kind", 32);
  const unit = readText(body, "unit", 32);
  const checkFrequency = readText(body, "checkFrequency", 32);
  const targetMin = readText(body, "targetMin", 64);
  const targetMax = readText(body, "targetMax", 64);
  const locationId = readText(body, "locationId", 64);
  if (
    code === null ||
    name === null ||
    kind === null ||
    unit === null ||
    checkFrequency === null ||
    targetMin === null ||
    targetMax === null ||
    locationId === null ||
    !isUuid(locationId)
  ) {
    return { ok: false };
  }

  const storageAreaId = readOptionalUuidBody(body, "storageAreaId");
  if (!storageAreaId.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      code,
      name,
      kind,
      unit,
      targetMin,
      targetMax,
      checkFrequency,
      locationId,
      storageAreaId: storageAreaId.value,
    },
  };
}

export interface RecordMonitoringReadingBody {
  readonly value: string;
  readonly measuredAt: string;
  readonly notes: string | null;
}

export type ParsedRecordMonitoringReading =
  { readonly ok: true; readonly input: RecordMonitoringReadingBody } | { readonly ok: false };

/** `POST .../[id]/readings` body: the measured value, instant and optional notes. */
export function parseRecordMonitoringReadingBody(
  body: Record<string, unknown> | undefined,
): ParsedRecordMonitoringReading {
  if (body === undefined) {
    return { ok: false };
  }
  const value = readText(body, "value", 64);
  const measuredAt = readText(body, "measuredAt", 64);
  if (value === null || measuredAt === null) {
    return { ok: false };
  }

  const notes = readOptionalBodyText(body, "notes", MAX_NOTES);
  if (!notes.ok) {
    return { ok: false };
  }

  return { ok: true, input: { value, measuredAt, notes: notes.value } };
}

/* ------------------------------ response rows ----------------------------- */

export interface MonitoringPointRow {
  readonly id: string;
  readonly locationId: string;
  readonly storageAreaId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly unit: string;
  readonly targetMin: string;
  readonly targetMax: string;
  readonly checkFrequency: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps point records to HTTP rows, dropping any foreign-organization point. */
export function toMonitoringPointRows(
  organizationId: string,
  points: readonly MonitoringPointRecord[],
): readonly MonitoringPointRow[] {
  const rows: MonitoringPointRow[] = [];
  for (const point of points) {
    if (point.organizationId !== organizationId) {
      continue;
    }
    rows.push({
      id: point.id,
      locationId: point.locationId,
      storageAreaId: point.storageAreaId,
      code: point.code,
      name: point.name,
      kind: point.kind,
      unit: point.unit,
      targetMin: point.targetMin,
      targetMax: point.targetMax,
      checkFrequency: point.checkFrequency,
      active: point.active,
      createdAt: point.createdAt,
      createdBy: point.createdBy,
    });
  }
  return rows;
}

export interface MonitoringReadingRow {
  readonly id: string;
  readonly monitoringPointId: string;
  readonly value: string;
  readonly unit: string;
  readonly measuredAt: string;
  readonly recordedBy: string | null;
  readonly inRange: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
}

/** Maps reading records to HTTP rows, dropping any foreign-organization reading. */
export function toMonitoringReadingRows(
  organizationId: string,
  readings: readonly MonitoringReadingRecord[],
): readonly MonitoringReadingRow[] {
  const rows: MonitoringReadingRow[] = [];
  for (const reading of readings) {
    if (reading.organizationId !== organizationId) {
      continue;
    }
    rows.push({
      id: reading.id,
      monitoringPointId: reading.monitoringPointId,
      value: reading.value,
      unit: reading.unit,
      measuredAt: reading.measuredAt,
      recordedBy: reading.recordedBy,
      inRange: reading.inRange,
      notes: reading.notes,
      createdAt: reading.createdAt,
    });
  }
  return rows;
}
