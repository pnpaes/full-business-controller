import {
  DEFAULT_EQUIPMENT_LIMIT,
  DEFAULT_MAINTENANCE_LOG_LIMIT,
  EQUIPMENT_CODE_MAX,
  EQUIPMENT_KIND_MAX,
  EQUIPMENT_NAME_MAX,
  EQUIPMENT_SERIAL_MAX,
  MAINTENANCE_KINDS,
  type EquipmentRecord,
  type MaintenanceLogRecord,
} from "@aquarela/application";

import { isUuid } from "./hms-rows";

export { isUuid };

/**
 * Pure query/body parsing and response mapping for the HMS equipment register
 * and its maintenance fact log (`HMS-006`, `DEC-092`, `DEC-097`). Kept free of
 * Next, DB and I/O imports so the routes do the reads and hand the application
 * results to the row mappers.
 *
 * The parsers do shape checks only (required text, UUIDs, `YYYY-MM-DD` days,
 * bounded paging): equipment `kind` is free text (`DEC-092` names no
 * vocabulary), so only its bound is checked. A maintenance log's `kind` **is**
 * vocabulary-backed, so unlike the incident parsers — which defer every
 * vocabulary to the command — it is checked here against the same
 * `MAINTENANCE_KINDS` the command uses, making a bad value a 400 without touching
 * the store. A `YYYY-MM-DD` field is calendar-checked here because the command
 * passes it straight to a Postgres `date` column; `performedAt` is an ISO
 * instant (`timestamptz`). The row mappers drop a foreign-organization row
 * defensively, like the other slices, even though the application reads are
 * already organization-scoped (`DEC-061`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 200;
const MAX_NOTES = 2000;
const MAX_INSTANT = 64;

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

/** Parses `limit`/`offset`; `defaultLimit` is the application's page default. */
function readPaging(
  searchParams: URLSearchParams,
  defaultLimit: number,
): { readonly ok: true; readonly limit: number; readonly offset: number } | { readonly ok: false } {
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  // `offset` is bounded too: without it a huge value would be passed straight to
  // the store.
  if (offset !== undefined && offset > MAX_LIMIT) {
    return { ok: false };
  }
  return { ok: true, limit: limit ?? defaultLimit, offset: offset ?? 0 };
}

function readUuidFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return isUuid(value) ? value : "invalid";
}

function readTextFilter(
  searchParams: URLSearchParams,
  key: string,
  max = EQUIPMENT_KIND_MAX,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= max ? value : "invalid";
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

function readText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** True when `value` is a real `YYYY-MM-DD` day (`date` column shaped). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** True when `value` is a full ISO-8601 instant (`timestamptz` shaped). */
function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

type OptionalField<T> =
  { readonly ok: true; readonly present: boolean; readonly value: T } | { readonly ok: false };

/** Optional free text: absent → not present; null/blank → `null`; wrong type/over-long → invalid. */
function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_NOTES,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string" || value.length > max) {
    return { ok: false };
  }
  const trimmed = value.trim();
  return { ok: true, present: true, value: trimmed.length === 0 ? null : trimmed };
}

/** Optional non-empty text (a patch field that must stay a string): blank → invalid. */
function readOptionalRequiredText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max
    ? { ok: true, present: true, value: trimmed }
    : { ok: false };
}

/** Optional uuid: absent → not present; null/blank → `null`; non-uuid → invalid. */
function readOptionalUuid(
  body: Record<string, unknown>,
  key: string,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, present: true, value: null };
  }
  return isUuid(trimmed) ? { ok: true, present: true, value: trimmed } : { ok: false };
}

/** Optional `YYYY-MM-DD`: absent → not present; null/blank → `null`; malformed → invalid. */
function readOptionalDate(
  body: Record<string, unknown>,
  key: string,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, present: true, value: null };
  }
  return isDate(trimmed) ? { ok: true, present: true, value: trimmed } : { ok: false };
}

/** Optional boolean: absent → not present; any non-boolean → invalid. */
function readOptionalBoolean(body: Record<string, unknown>, key: string): OptionalField<boolean> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: false };
  }
  return typeof value === "boolean" ? { ok: true, present: true, value } : { ok: false };
}

/* --------------------------------- queries -------------------------------- */

export interface EquipmentListQuery {
  readonly locationId?: string;
  readonly kind?: string;
  readonly active?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedEquipmentListQuery =
  { readonly ok: true; readonly query: EquipmentListQuery } | { readonly ok: false };

/** Parses the optional `locationId`/`kind`/`active` filters and `limit`/`offset` paging. */
export function parseEquipmentListQuery(searchParams: URLSearchParams): ParsedEquipmentListQuery {
  const locationId = readUuidFilter(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const kind = readTextFilter(searchParams, "kind");
  if (kind === "invalid") {
    return { ok: false };
  }
  const active = readOptionalQueryBoolean(searchParams, "active");
  if (active === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_EQUIPMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(locationId === undefined ? {} : { locationId }),
      ...(kind === undefined ? {} : { kind }),
      ...(active === undefined ? {} : { active }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface MaintenanceLogListQuery {
  readonly equipmentId?: string;
  readonly kind?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedMaintenanceLogListQuery =
  { readonly ok: true; readonly query: MaintenanceLogListQuery } | { readonly ok: false };

/** Parses the optional `equipmentId`/`kind` filters and `limit`/`offset` paging. */
export function parseMaintenanceLogListQuery(
  searchParams: URLSearchParams,
): ParsedMaintenanceLogListQuery {
  const equipmentId = readUuidFilter(searchParams, "equipmentId");
  if (equipmentId === "invalid") {
    return { ok: false };
  }
  const kind = readTextFilter(searchParams, "kind");
  if (kind === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_MAINTENANCE_LOG_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(equipmentId === undefined ? {} : { equipmentId }),
      ...(kind === undefined ? {} : { kind }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface MaintenanceLogPageQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedMaintenanceLogPageQuery =
  { readonly ok: true; readonly query: MaintenanceLogPageQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` paging of one equipment's maintenance-log page. */
export function parseMaintenanceLogPageQuery(
  searchParams: URLSearchParams,
): ParsedMaintenanceLogPageQuery {
  const paging = readPaging(searchParams, DEFAULT_MAINTENANCE_LOG_LIMIT);
  return paging.ok ? { ok: true, query: paging } : { ok: false };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateEquipmentBody {
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  /** Free text (`DEC-092` names no vocabulary); non-blank. */
  readonly kind: string;
  readonly serialNo: string | null;
  readonly installedAt: string | null;
  readonly warrantyUntil: string | null;
  /** Absent → the command keeps its `true` default. */
  readonly active?: boolean;
}

export type ParsedCreateEquipment =
  { readonly ok: true; readonly input: CreateEquipmentBody } | { readonly ok: false };

/** `POST /equipment` body: the register key, description, location and optional dates. */
export function parseCreateEquipmentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateEquipment {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const code = readText(body, "code", EQUIPMENT_CODE_MAX);
  const name = readText(body, "name", EQUIPMENT_NAME_MAX);
  const kind = readText(body, "kind", EQUIPMENT_KIND_MAX);
  if (
    locationId === null ||
    !isUuid(locationId) ||
    code === null ||
    name === null ||
    kind === null
  ) {
    return { ok: false };
  }

  const serialNo = readOptionalText(body, "serialNo", EQUIPMENT_SERIAL_MAX);
  const installedAt = readOptionalDate(body, "installedAt");
  const warrantyUntil = readOptionalDate(body, "warrantyUntil");
  const active = readOptionalBoolean(body, "active");
  if (!serialNo.ok || !installedAt.ok || !warrantyUntil.ok || !active.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      locationId,
      code,
      name,
      kind,
      serialNo: serialNo.value,
      installedAt: installedAt.value,
      warrantyUntil: warrantyUntil.value,
      ...(active.present ? { active: active.value } : {}),
    },
  };
}

export interface UpdateEquipmentBody {
  readonly name?: string;
  readonly kind?: string;
  readonly serialNo?: string | null;
  readonly installedAt?: string | null;
  readonly warrantyUntil?: string | null;
  readonly active?: boolean;
}

export type ParsedUpdateEquipment =
  { readonly ok: true; readonly input: UpdateEquipmentBody } | { readonly ok: false };

/**
 * `PATCH /equipment/[id]` body: any subset of the mutable fields. `code` (the
 * register key) and `locationId` are immutable, so neither is accepted here.
 */
export function parseUpdateEquipmentBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateEquipment {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readOptionalRequiredText(body, "name", EQUIPMENT_NAME_MAX);
  const kind = readOptionalRequiredText(body, "kind", EQUIPMENT_KIND_MAX);
  const serialNo = readOptionalText(body, "serialNo", EQUIPMENT_SERIAL_MAX);
  const installedAt = readOptionalDate(body, "installedAt");
  const warrantyUntil = readOptionalDate(body, "warrantyUntil");
  const active = readOptionalBoolean(body, "active");
  if (!name.ok || !kind.ok || !serialNo.ok || !installedAt.ok || !warrantyUntil.ok || !active.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(name.present ? { name: name.value } : {}),
      ...(kind.present ? { kind: kind.value } : {}),
      ...(serialNo.present ? { serialNo: serialNo.value } : {}),
      ...(installedAt.present ? { installedAt: installedAt.value } : {}),
      ...(warrantyUntil.present ? { warrantyUntil: warrantyUntil.value } : {}),
      ...(active.present ? { active: active.value } : {}),
    },
  };
}

export interface RecordMaintenanceLogBody {
  /** One of `MAINTENANCE_KINDS` (service/repair/inspection). */
  readonly kind: string;
  /** ISO instant the maintenance was performed at. */
  readonly performedAt: string;
  readonly notes: string | null;
  readonly fileObjectId: string | null;
}

export type ParsedRecordMaintenanceLog =
  { readonly ok: true; readonly input: RecordMaintenanceLogBody } | { readonly ok: false };

/**
 * `POST /equipment/[id]/maintenance-logs` body; the equipment link is the path
 * id and `performedBy` is the session actor, filled by the route. The `kind`
 * vocabulary is checked here (`MAINTENANCE_KINDS`), so a bad value is a 400
 * before the store is touched; the command re-checks it as the authority.
 */
export function parseRecordMaintenanceLogBody(
  body: Record<string, unknown> | undefined,
): ParsedRecordMaintenanceLog {
  if (body === undefined) {
    return { ok: false };
  }
  const kind = readText(body, "kind", EQUIPMENT_KIND_MAX);
  const performedAt = readText(body, "performedAt", MAX_INSTANT);
  if (kind === null || !MAINTENANCE_KINDS.includes(kind) || performedAt === null) {
    return { ok: false };
  }
  if (!isIsoInstant(performedAt)) {
    return { ok: false };
  }
  const notes = readOptionalText(body, "notes", MAX_NOTES);
  const fileObjectId = readOptionalUuid(body, "fileObjectId");
  if (!notes.ok || !fileObjectId.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: { kind, performedAt, notes: notes.value, fileObjectId: fileObjectId.value },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface EquipmentRow {
  readonly id: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly serialNo: string | null;
  readonly installedAt: string | null;
  readonly warrantyUntil: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one equipment row to an HTTP row; `undefined` for a foreign-organization row. */
export function toEquipmentRow(
  organizationId: string,
  equipment: EquipmentRecord,
): EquipmentRow | undefined {
  if (equipment.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: equipment.id,
    locationId: equipment.locationId,
    code: equipment.code,
    name: equipment.name,
    kind: equipment.kind,
    serialNo: equipment.serialNo,
    installedAt: equipment.installedAt,
    warrantyUntil: equipment.warrantyUntil,
    active: equipment.active,
    createdAt: equipment.createdAt,
    createdBy: equipment.createdBy,
  };
}

/** Maps equipment records to HTTP rows, dropping any foreign-organization row. */
export function toEquipmentRows(
  organizationId: string,
  equipment: readonly EquipmentRecord[],
): readonly EquipmentRow[] {
  const rows: EquipmentRow[] = [];
  for (const item of equipment) {
    const row = toEquipmentRow(organizationId, item);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface MaintenanceLogRow {
  readonly id: string;
  readonly equipmentId: string;
  readonly kind: string;
  readonly performedAt: string;
  readonly performedBy: string;
  readonly notes: string | null;
  readonly fileObjectId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one maintenance log to an HTTP row; `undefined` for a foreign-organization row. */
export function toMaintenanceLogRow(
  organizationId: string,
  log: MaintenanceLogRecord,
): MaintenanceLogRow | undefined {
  if (log.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: log.id,
    equipmentId: log.equipmentId,
    kind: log.kind,
    performedAt: log.performedAt,
    performedBy: log.performedBy,
    notes: log.notes,
    fileObjectId: log.fileObjectId,
    createdAt: log.createdAt,
    createdBy: log.createdBy,
  };
}

/** Maps maintenance-log records to HTTP rows, dropping any foreign-organization row. */
export function toMaintenanceLogRows(
  organizationId: string,
  logs: readonly MaintenanceLogRecord[],
): readonly MaintenanceLogRow[] {
  const rows: MaintenanceLogRow[] = [];
  for (const log of logs) {
    const row = toMaintenanceLogRow(organizationId, log);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
