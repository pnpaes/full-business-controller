import {
  DEFAULT_EMPLOYEE_DOCUMENT_LIMIT,
  DEFAULT_EMPLOYEE_LIMIT,
  DEFAULT_PAYROLL_REPORT_LIMIT,
  DEFAULT_POSITION_LIMIT,
  DEFAULT_SHIFT_ADJUSTMENT_LIMIT,
  DEFAULT_SHIFT_ASSIGNMENT_LIMIT,
  DEFAULT_SHIFT_LIMIT,
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYMENT_TYPES,
  PAYROLL_REPORT_STATUSES,
  SHIFT_STATES,
  type AvailableShiftRow as SchedulingAvailableShiftRow,
  type EmployeeDocumentRecord,
  type EmployeeRecord,
  type MyShiftRow as SchedulingMyShiftRow,
  type PayrollReportRecord,
  type PendingSelfAssignmentRow as SchedulingPendingSelfAssignmentRow,
  type PositionRecord,
  type ShiftAdjustmentRecord,
  type ShiftAssignmentRecord,
  type ShiftRecord,
} from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

import type { FileUploadPolicy } from "../../../../lib/file-upload";

export { isUuid };

/**
 * Upload policy and retention class for the payroll-export consumer (`DEC-133`):
 * the artefact is a CSV or PDF, capped at 10 MiB. These live here rather than in
 * the route module because a Next route file may only export HTTP handlers.
 */
export const PAYROLL_EXPORT_UPLOAD_POLICY: FileUploadPolicy = {
  allowedMime: ["text/csv", "application/pdf"],
  maxBytes: 10 * 1024 * 1024,
};
export const PAYROLL_EXPORT_RETENTION_POLICY = "payroll_export";

/**
 * Upload policy and retention class for the employee-document consumer
 * (`DEC-133`): a contract, certificate or ID scan — PDF, image or Word — capped
 * at 10 MiB.
 */
export const EMPLOYEE_DOCUMENT_UPLOAD_POLICY: FileUploadPolicy = {
  allowedMime: [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  maxBytes: 10 * 1024 * 1024,
};
export const EMPLOYEE_DOCUMENT_RETENTION_POLICY = "employee_document";

/**
 * Pure query/body parsing and response mapping for the workforce personnel
 * routes (`DEC-087`, `DEC-099`). Kept free of Next, DB and I/O imports so the
 * routes do the reads and hand the application results to the row mappers.
 *
 * The parsers do shape checks only where the value would otherwise reach a
 * Postgres column directly: `YYYY-MM-DD` days are calendar-checked, money is
 * `numeric(19,4)`-shaped (a JS float, a negative or a 5-decimal string is a 400
 * here rather than a driver/command error) and the `employmentType` /
 * document-`kind` vocabularies — exported by the application — are checked
 * against the same constants the commands use, so a bad value never reaches the
 * store. `expiresAt`/`activeTo` cross-field ordering is checked in the parser
 * only where both sides are in the same body (create); a patch that moves one
 * side against the immutable stored value stays the command's authority and
 * surfaces as a `DomainError` (400). The row mappers drop a foreign-organization
 * row defensively, like the other slices, even though the application reads are
 * already organization-scoped (`DEC-061`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A full ISO-8601 instant with seconds and a zone (`timestamptz` shaped). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
/** A plain non-negative decimal at most four places (`numeric(19,4)` money). */
const MONEY = /^\d+(?:\.\d{1,4})?$/;
/** A plain non-negative decimal at most two places (`numeric(_,2)` hours). */
const ADJUSTED_HOURS = /^\d+(?:\.\d{1,2})?$/;
/** `numeric(9,2)` holds at most `9999999.99`; `>= 10^7` would overflow the column. */
const MAX_ADJUSTED_HOURS_VALUE = 10_000_000n;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
/** A rejection reason may be a sentence or two; bounded like the others. */
const MAX_REASON = 500;
const MAX_VOCAB = 32;
const MAX_MONEY = 64;
const MAX_ADJUSTED_HOURS = 32;
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

/**
 * Parses `limit`/`offset`; both are bounded (`MAX_LIMIT`) so a huge `offset`
 * cannot be passed straight to the store. `defaultLimit` is the matching
 * application page default.
 */
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

/** An optional fixed-vocabulary filter: absent → `undefined`; a non-member → `"invalid"`. */
function readVocabFilter(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[],
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_VOCAB && values.includes(value)
    ? value
    : "invalid";
}

/** An optional ISO-instant filter: absent → `undefined`; malformed → `"invalid"`. */
function readInstantFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_INSTANT && isIsoInstant(value) ? value : "invalid";
}

/** True when `value` is a full ISO-8601 instant (`timestamptz` shaped, seconds required). */
function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
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

/** A required value from a fixed vocabulary; a non-member is invalid. */
function readVocab(
  body: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string | null {
  const value = readText(body, key, MAX_VOCAB);
  return value !== null && values.includes(value) ? value : null;
}

/** A required `numeric(19,4)` money string; a float, sign or 5-decimals is invalid. */
function readMoney(body: Record<string, unknown>, key: string): string | null {
  const value = readText(body, key, MAX_MONEY);
  return value !== null && MONEY.test(value) ? value : null;
}

/** True when `value` is a real `YYYY-MM-DD` day (`date` column shaped). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type OptionalField<T> =
  { readonly ok: true; readonly present: boolean; readonly value: T } | { readonly ok: false };

/** Optional non-empty text (a patch field that must stay a string): blank → invalid. */
function readOptionalRequiredText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
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

/** Optional vocabulary member: absent → not present; a non-member/blank → invalid. */
function readOptionalVocab(
  body: Record<string, unknown>,
  key: string,
  values: readonly string[],
): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_VOCAB && values.includes(trimmed)
    ? { ok: true, present: true, value: trimmed }
    : { ok: false };
}

/** Optional money string: absent → not present; a float/sign/5-decimals/blank → invalid. */
function readOptionalMoney(body: Record<string, unknown>, key: string): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_MONEY && MONEY.test(trimmed)
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

/**
 * Optional array of UUIDs (`DEC-151`): absent → not present; an array whose every
 * member is a UUID → the deduped trimmed list; a non-array, a non-string member
 * or a non-UUID value → invalid. An empty array is a valid "clear".
 */
function readOptionalUuidArray(
  body: Record<string, unknown>,
  key: string,
): OptionalField<readonly string[]> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false };
  }
  const ids: string[] = [];
  for (const member of value) {
    if (typeof member !== "string") {
      return { ok: false };
    }
    const trimmed = member.trim();
    if (!isUuid(trimmed)) {
      return { ok: false };
    }
    if (!ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  }
  return { ok: true, present: true, value: ids };
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

/** Optional ISO instant: absent → not present; null/blank/malformed → invalid for a shift field. */
function readOptionalInstant(body: Record<string, unknown>, key: string): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_INSTANT && isIsoInstant(trimmed)
    ? { ok: true, present: true, value: trimmed }
    : { ok: false };
}

/** Optional free text: absent → not present; null/blank → `null`; wrong type/over-long → invalid. */
function readOptionalNullableText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
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

/** Optional `breakMinutes`: absent → not present; a non-integer/negative → invalid. */
function readOptionalBreakMinutes(body: Record<string, unknown>): OptionalField<number> {
  const value = body["breakMinutes"];
  if (value === undefined) {
    return { ok: true, present: false, value: 0 };
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, present: true, value };
}

/* --------------------------------- queries -------------------------------- */

export interface EmployeeListQuery {
  readonly primaryLocationId?: string;
  /** `true` = not retired; `false` = retired. */
  readonly active?: boolean;
  /** `true` = retired; `false` = not retired. */
  readonly retired?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedEmployeeListQuery =
  { readonly ok: true; readonly query: EmployeeListQuery } | { readonly ok: false };

/** Parses the optional `primaryLocationId`/`active`/`retired` filters and paging. */
export function parseEmployeeListQuery(searchParams: URLSearchParams): ParsedEmployeeListQuery {
  const primaryLocationId = readUuidFilter(searchParams, "primaryLocationId");
  if (primaryLocationId === "invalid") {
    return { ok: false };
  }
  const active = readOptionalQueryBoolean(searchParams, "active");
  if (active === "invalid") {
    return { ok: false };
  }
  const retired = readOptionalQueryBoolean(searchParams, "retired");
  if (retired === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_EMPLOYEE_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(primaryLocationId === undefined ? {} : { primaryLocationId }),
      ...(active === undefined ? {} : { active }),
      ...(retired === undefined ? {} : { retired }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface EmployeeDocumentListQuery {
  /** One of `EMPLOYEE_DOCUMENT_KIND`, exact match. */
  readonly kind?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedEmployeeDocumentListQuery =
  { readonly ok: true; readonly query: EmployeeDocumentListQuery } | { readonly ok: false };

/** Parses the optional `kind` filter and `limit`/`offset` paging of an employee's documents. */
export function parseEmployeeDocumentListQuery(
  searchParams: URLSearchParams,
): ParsedEmployeeDocumentListQuery {
  const rawKind = searchParams.get("kind");
  let kind: string | undefined;
  if (rawKind !== null) {
    const value = rawKind.trim();
    // A non-member must not be passed through as an exact-match filter: the
    // vocabulary check (the same `EMPLOYEE_DOCUMENT_KINDS` the commands use)
    // makes `?kind=bogus` a 400 rather than a silently empty 200.
    if (
      value.length === 0 ||
      value.length > MAX_VOCAB ||
      !EMPLOYEE_DOCUMENT_KINDS.includes(value)
    ) {
      return { ok: false };
    }
    kind = value;
  }
  const paging = readPaging(searchParams, DEFAULT_EMPLOYEE_DOCUMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(kind === undefined ? {} : { kind }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateEmployeeBody {
  readonly userId: string | null;
  readonly name: string;
  readonly roleCode: string;
  readonly employmentType: string;
  readonly baseHourlyRate: string;
  readonly costCenterId: string | null;
  readonly primaryLocationId: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
  /** `DEC-151`: the initial position set (deduped, validated by the command). */
  readonly positionIds: readonly string[];
}

export type ParsedCreateEmployee =
  { readonly ok: true; readonly input: CreateEmployeeBody } | { readonly ok: false };

/** `POST /employees` body: the person, their terms, optional links and active range. */
export function parseCreateEmployeeBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateEmployee {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readText(body, "name");
  const roleCode = readText(body, "roleCode");
  const employmentType = readVocab(body, "employmentType", EMPLOYMENT_TYPES);
  const baseHourlyRate = readMoney(body, "baseHourlyRate");
  const activeFrom = readOptionalDate(body, "activeFrom");
  if (
    name === null ||
    roleCode === null ||
    employmentType === null ||
    baseHourlyRate === null ||
    !activeFrom.ok ||
    !activeFrom.present ||
    activeFrom.value === null
  ) {
    return { ok: false };
  }

  const userId = readOptionalUuid(body, "userId");
  const costCenterId = readOptionalUuid(body, "costCenterId");
  const primaryLocationId = readOptionalUuid(body, "primaryLocationId");
  const activeTo = readOptionalDate(body, "activeTo");
  const positionIds = readOptionalUuidArray(body, "positionIds");
  if (!userId.ok || !costCenterId.ok || !primaryLocationId.ok || !activeTo.ok || !positionIds.ok) {
    return { ok: false };
  }
  if (activeTo.value !== null && activeTo.value <= activeFrom.value) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      userId: userId.value,
      name,
      roleCode,
      employmentType,
      baseHourlyRate,
      costCenterId: costCenterId.value,
      primaryLocationId: primaryLocationId.value,
      activeFrom: activeFrom.value,
      activeTo: activeTo.value,
      positionIds: positionIds.value,
    },
  };
}

export interface UpdateEmployeeBody {
  readonly name?: string;
  readonly roleCode?: string;
  readonly employmentType?: string;
  readonly baseHourlyRate?: string;
  readonly costCenterId?: string | null;
  readonly primaryLocationId?: string | null;
  readonly activeTo?: string | null;
  /** `DEC-151`: replaces the whole position set when present. */
  readonly positionIds?: readonly string[];
}

export type ParsedUpdateEmployee =
  { readonly ok: true; readonly input: UpdateEmployeeBody } | { readonly ok: false };

/**
 * `PATCH /employees/[id]` body: any subset of the mutable fields. `activeFrom`,
 * `userId` and `retiredAt` are not patchable here — `activeFrom`/`userId` are
 * immutable after creation and retirement is the dedicated command.
 */
export function parseUpdateEmployeeBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateEmployee {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readOptionalRequiredText(body, "name");
  const roleCode = readOptionalRequiredText(body, "roleCode");
  const employmentType = readOptionalVocab(body, "employmentType", EMPLOYMENT_TYPES);
  const baseHourlyRate = readOptionalMoney(body, "baseHourlyRate");
  const costCenterId = readOptionalUuid(body, "costCenterId");
  const primaryLocationId = readOptionalUuid(body, "primaryLocationId");
  const activeTo = readOptionalDate(body, "activeTo");
  const positionIds = readOptionalUuidArray(body, "positionIds");
  if (
    !name.ok ||
    !roleCode.ok ||
    !employmentType.ok ||
    !baseHourlyRate.ok ||
    !costCenterId.ok ||
    !primaryLocationId.ok ||
    !activeTo.ok ||
    !positionIds.ok
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(name.present ? { name: name.value } : {}),
      ...(roleCode.present ? { roleCode: roleCode.value } : {}),
      ...(employmentType.present ? { employmentType: employmentType.value } : {}),
      ...(baseHourlyRate.present ? { baseHourlyRate: baseHourlyRate.value } : {}),
      ...(costCenterId.present ? { costCenterId: costCenterId.value } : {}),
      ...(primaryLocationId.present ? { primaryLocationId: primaryLocationId.value } : {}),
      ...(activeTo.present ? { activeTo: activeTo.value } : {}),
      ...(positionIds.present ? { positionIds: positionIds.value } : {}),
    },
  };
}

export interface CreateEmployeeDocumentBody {
  readonly kind: string;
  readonly title: string;
  readonly fileObjectId: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
}

export type ParsedCreateEmployeeDocument =
  { readonly ok: true; readonly input: CreateEmployeeDocumentBody } | { readonly ok: false };

/** `POST /employees/[id]/documents` body; the employee link is the path id. */
export function parseCreateEmployeeDocumentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateEmployeeDocument {
  if (body === undefined) {
    return { ok: false };
  }
  const kind = readVocab(body, "kind", EMPLOYEE_DOCUMENT_KINDS);
  const title = readText(body, "title");
  if (kind === null || title === null) {
    return { ok: false };
  }
  const fileObjectId = readOptionalUuid(body, "fileObjectId");
  const issuedAt = readOptionalDate(body, "issuedAt");
  const expiresAt = readOptionalDate(body, "expiresAt");
  if (!fileObjectId.ok || !issuedAt.ok || !expiresAt.ok) {
    return { ok: false };
  }
  if (issuedAt.value !== null && expiresAt.value !== null && expiresAt.value < issuedAt.value) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      kind,
      title,
      fileObjectId: fileObjectId.value,
      issuedAt: issuedAt.value,
      expiresAt: expiresAt.value,
    },
  };
}

export interface UpdateEmployeeDocumentBody {
  readonly kind?: string;
  readonly title?: string;
  readonly fileObjectId?: string | null;
  readonly issuedAt?: string | null;
  readonly expiresAt?: string | null;
}

export type ParsedUpdateEmployeeDocument =
  { readonly ok: true; readonly input: UpdateEmployeeDocumentBody } | { readonly ok: false };

/**
 * `PATCH /employee-documents/[id]` body: any subset of the mutable metadata
 * fields. The `issuedAt`/`expiresAt` window is re-checked by the command against
 * the stored values, so a one-sided patch that breaks the window is a 400 there.
 */
export function parseUpdateEmployeeDocumentBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateEmployeeDocument {
  if (body === undefined) {
    return { ok: false };
  }
  const kind = readOptionalVocab(body, "kind", EMPLOYEE_DOCUMENT_KINDS);
  const title = readOptionalRequiredText(body, "title");
  const fileObjectId = readOptionalUuid(body, "fileObjectId");
  const issuedAt = readOptionalDate(body, "issuedAt");
  const expiresAt = readOptionalDate(body, "expiresAt");
  if (!kind.ok || !title.ok || !fileObjectId.ok || !issuedAt.ok || !expiresAt.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(kind.present ? { kind: kind.value } : {}),
      ...(title.present ? { title: title.value } : {}),
      ...(fileObjectId.present ? { fileObjectId: fileObjectId.value } : {}),
      ...(issuedAt.present ? { issuedAt: issuedAt.value } : {}),
      ...(expiresAt.present ? { expiresAt: expiresAt.value } : {}),
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface EmployeeRow {
  readonly id: string;
  readonly userId: string | null;
  readonly name: string;
  readonly roleCode: string;
  readonly employmentType: string;
  readonly baseHourlyRate: string;
  readonly costCenterId: string | null;
  readonly primaryLocationId: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
  /** `DEC-151`: the positions the employee holds. */
  readonly positionIds: readonly string[];
  readonly retiredAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one employee to an HTTP row; `undefined` for a foreign-organization row. */
export function toEmployeeRow(
  organizationId: string,
  employee: EmployeeRecord,
): EmployeeRow | undefined {
  if (employee.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: employee.id,
    userId: employee.userId,
    name: employee.name,
    roleCode: employee.roleCode,
    employmentType: employee.employmentType,
    baseHourlyRate: employee.baseHourlyRate,
    costCenterId: employee.costCenterId,
    primaryLocationId: employee.primaryLocationId,
    activeFrom: employee.activeFrom,
    activeTo: employee.activeTo,
    positionIds: employee.positionIds,
    retiredAt: employee.retiredAt,
    createdAt: employee.createdAt,
    createdBy: employee.createdBy,
  };
}

/** Maps employee records to HTTP rows, dropping any foreign-organization employee. */
export function toEmployeeRows(
  organizationId: string,
  employees: readonly EmployeeRecord[],
): readonly EmployeeRow[] {
  const rows: EmployeeRow[] = [];
  for (const employee of employees) {
    const row = toEmployeeRow(organizationId, employee);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface EmployeeDocumentRow {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: string;
  readonly title: string;
  readonly fileObjectId: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one personnel document to an HTTP row; `undefined` for a foreign-organization row. */
export function toEmployeeDocumentRow(
  organizationId: string,
  document: EmployeeDocumentRecord,
): EmployeeDocumentRow | undefined {
  if (document.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: document.id,
    employeeId: document.employeeId,
    kind: document.kind,
    title: document.title,
    fileObjectId: document.fileObjectId,
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    createdAt: document.createdAt,
    createdBy: document.createdBy,
  };
}

/** Maps document records to HTTP rows, dropping any foreign-organization document. */
export function toEmployeeDocumentRows(
  organizationId: string,
  documents: readonly EmployeeDocumentRecord[],
): readonly EmployeeDocumentRow[] {
  const rows: EmployeeDocumentRow[] = [];
  for (const document of documents) {
    const row = toEmployeeDocumentRow(organizationId, document);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/* ------------------------------ shift scheduling -------------------------- */

/**
 * Shift-scheduling query/body parsing and row mapping (`WF-002`, `WF-003`,
 * `DEC-037`, `DEC-038`), kept beside the personnel parsers so the slice has one
 * wire-shape module.
 *
 * The parsers do shape checks only where the value would otherwise reach a
 * Postgres column directly: `startsAt`/`endsAt`/`from`/`to` must be full
 * ISO-8601 instants (seconds required — the same `timestamptz` shape the HMS
 * instant parsers use), `breakMinutes` a non-negative integer (the command's
 * `assertBreakMinutes` counterpart), and the `state` vocabulary is checked
 * against the application `SHIFT_STATES` so `?state=bogus` is a 400 rather than
 * a silently empty page. The `startsAt`/`endsAt` ordering stays the command's
 * authority and surfaces as a `DomainError` (400). The row mappers drop a
 * foreign-organization row defensively, like the other slices, even though the
 * application reads are already organization-scoped (`DEC-061`).
 */

export interface ShiftListQuery {
  readonly locationId?: string;
  /** One of `SHIFT_STATES`, exact match. */
  readonly state?: string;
  /** Inclusive lower bound on `startsAt`; an ISO instant. */
  readonly from?: string;
  /** Inclusive upper bound on `startsAt`; an ISO instant. */
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedShiftListQuery =
  { readonly ok: true; readonly query: ShiftListQuery } | { readonly ok: false };

/** Parses the optional `locationId`/`state`/`from`/`to` filters and `limit`/`offset` paging. */
export function parseShiftListQuery(searchParams: URLSearchParams): ParsedShiftListQuery {
  const locationId = readUuidFilter(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const state = readVocabFilter(searchParams, "state", SHIFT_STATES);
  if (state === "invalid") {
    return { ok: false };
  }
  const from = readInstantFilter(searchParams, "from");
  if (from === "invalid") {
    return { ok: false };
  }
  const to = readInstantFilter(searchParams, "to");
  if (to === "invalid") {
    return { ok: false };
  }
  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_SHIFT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(locationId === undefined ? {} : { locationId }),
      ...(state === undefined ? {} : { state }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface ShiftAssignmentListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedShiftAssignmentListQuery =
  { readonly ok: true; readonly query: ShiftAssignmentListQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` paging of one shift's assignment page. */
export function parseShiftAssignmentListQuery(
  searchParams: URLSearchParams,
): ParsedShiftAssignmentListQuery {
  const paging = readPaging(searchParams, DEFAULT_SHIFT_ASSIGNMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return { ok: true, query: { limit: paging.limit, offset: paging.offset } };
}

export interface CreateShiftBody {
  readonly locationId: string;
  /** `DEC-151` staffing position; blank/omitted becomes `null` (any position). */
  readonly positionId: string | null;
  /** Legacy free-text role; blank/omitted becomes `null`. */
  readonly roleCode: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes?: number;
}

export type ParsedCreateShift =
  | { readonly ok: true; readonly input: CreateShiftBody }
  | {
      readonly ok: false;
    };

/** `POST /shifts` body: the location, optional role, the window and the break. */
export function parseCreateShiftBody(body: Record<string, unknown> | undefined): ParsedCreateShift {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId");
  if (locationId === null || !isUuid(locationId)) {
    return { ok: false };
  }
  const startsAt = readOptionalInstant(body, "startsAt");
  const endsAt = readOptionalInstant(body, "endsAt");
  if (!startsAt.ok || !startsAt.present || !endsAt.ok || !endsAt.present) {
    return { ok: false };
  }
  const roleCode = readOptionalNullableText(body, "roleCode");
  const positionId = readOptionalUuid(body, "positionId");
  const breakMinutes = readOptionalBreakMinutes(body);
  if (!roleCode.ok || !positionId.ok || !breakMinutes.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      locationId,
      positionId: positionId.value,
      roleCode: roleCode.value,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      ...(breakMinutes.present ? { breakMinutes: breakMinutes.value } : {}),
    },
  };
}

export interface UpdateShiftBody {
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly breakMinutes?: number;
  /** `DEC-151`; blank/`null` clears it (any position). */
  readonly positionId?: string | null;
  /** Legacy free text; blank/`null` clears it. */
  readonly roleCode?: string | null;
}

export type ParsedUpdateShift =
  | { readonly ok: true; readonly input: UpdateShiftBody }
  | {
      readonly ok: false;
    };

/** `PATCH /shifts/[id]` body: any subset of the mutable window/break/role fields. */
export function parseUpdateShiftBody(body: Record<string, unknown> | undefined): ParsedUpdateShift {
  if (body === undefined) {
    return { ok: false };
  }
  const startsAt = readOptionalInstant(body, "startsAt");
  const endsAt = readOptionalInstant(body, "endsAt");
  const breakMinutes = readOptionalBreakMinutes(body);
  const roleCode = readOptionalNullableText(body, "roleCode");
  const positionId = readOptionalUuid(body, "positionId");
  if (!startsAt.ok || !endsAt.ok || !breakMinutes.ok || !roleCode.ok || !positionId.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(startsAt.present ? { startsAt: startsAt.value } : {}),
      ...(endsAt.present ? { endsAt: endsAt.value } : {}),
      ...(breakMinutes.present ? { breakMinutes: breakMinutes.value } : {}),
      ...(roleCode.present ? { roleCode: roleCode.value } : {}),
      ...(positionId.present ? { positionId: positionId.value } : {}),
    },
  };
}

export interface CreateShiftAssignmentBody {
  readonly employeeId: string;
  /** `DEC-151`: recorded manager override of the position match. */
  readonly override: boolean;
}

export type ParsedCreateShiftAssignment =
  { readonly ok: true; readonly input: CreateShiftAssignmentBody } | { readonly ok: false };

/**
 * `POST /shifts/[id]/assignments` body; the shift link is the path id. `override`
 * (`DEC-151`) is optional and defaults to false; a non-boolean is a 400.
 */
export function parseCreateShiftAssignmentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateShiftAssignment {
  if (body === undefined) {
    return { ok: false };
  }
  const employeeId = readText(body, "employeeId");
  if (employeeId === null || !isUuid(employeeId)) {
    return { ok: false };
  }
  const override = body["override"];
  if (override !== undefined && typeof override !== "boolean") {
    return { ok: false };
  }
  return { ok: true, input: { employeeId, override: override === true } };
}

export interface DecideSelfAssignmentBody {
  readonly decision: "approved" | "rejected";
  /** Non-blank rejection reason; omitted when the body has none. */
  readonly reason?: string;
}

export type ParsedDecideSelfAssignment =
  { readonly ok: true; readonly input: DecideSelfAssignmentBody } | { readonly ok: false };

/**
 * `POST /shift-assignments/[id]/decide` body: the manager's
 * `approved`/`rejected` decision and, for a rejection, a reason. A missing or
 * non-member `decision` is a 400; the reason is optional here and a rejection
 * without one is refused by the command (`DomainError`, 400). A blank reason is
 * omitted rather than passed through.
 */
export function parseDecideSelfAssignmentBody(
  body: Record<string, unknown> | undefined,
): ParsedDecideSelfAssignment {
  if (body === undefined) {
    return { ok: false };
  }
  const decision = body["decision"];
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false };
  }
  const reason = readOptionalNullableText(body, "reason", MAX_REASON);
  if (!reason.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      decision,
      ...(reason.value === null ? {} : { reason: reason.value }),
    },
  };
}

export interface CreateShiftAdjustmentBody {
  readonly adjustedHours: string;
  readonly reason: string;
}

export type ParsedCreateShiftAdjustment =
  { readonly ok: true; readonly input: CreateShiftAdjustmentBody } | { readonly ok: false };

/**
 * `POST /shift-assignments/[id]/adjustments` body; the assignment link is the
 * path id. `adjustedHours` must be a non-negative decimal **string** of at most
 * two places and within the `numeric(9,2)` range (`< 10^7`) — a JSON
 * number/float is rejected here so a binary float never reaches the store, and
 * an over-range value is a 400 rather than a database `22003` — and `reason`
 * non-blank text.
 */
export function parseCreateShiftAdjustmentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateShiftAdjustment {
  if (body === undefined) {
    return { ok: false };
  }
  const adjustedHours = readText(body, "adjustedHours", MAX_ADJUSTED_HOURS);
  const reason = readText(body, "reason");
  if (adjustedHours === null || !ADJUSTED_HOURS.test(adjustedHours) || reason === null) {
    return { ok: false };
  }
  const [whole = "0"] = adjustedHours.split(".");
  if (BigInt(whole) >= MAX_ADJUSTED_HOURS_VALUE) {
    return { ok: false };
  }
  return { ok: true, input: { adjustedHours, reason } };
}

export interface ShiftAdjustmentListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedShiftAdjustmentListQuery =
  { readonly ok: true; readonly query: ShiftAdjustmentListQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` paging of one assignment's adjustment page. */
export function parseShiftAdjustmentListQuery(
  searchParams: URLSearchParams,
): ParsedShiftAdjustmentListQuery {
  const paging = readPaging(searchParams, DEFAULT_SHIFT_ADJUSTMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return { ok: true, query: { limit: paging.limit, offset: paging.offset } };
}

export interface WorkedHoursQuery {
  readonly from: string;
  readonly to: string;
  readonly locationId?: string;
  readonly employeeId?: string;
}

export type ParsedWorkedHoursQuery =
  { readonly ok: true; readonly query: WorkedHoursQuery } | { readonly ok: false };

/**
 * Parses the worked-hours report query (`WF-004`): required `from`/`to` ISO
 * instants with seconds forming a half-open window (`from < to`; an equal or
 * inverted pair is a 400), plus optional `locationId`/`employeeId` UUID filters.
 * The window is checked here only for shape and order; the command re-validates.
 */
export function parseWorkedHoursQuery(searchParams: URLSearchParams): ParsedWorkedHoursQuery {
  const from = readInstantFilter(searchParams, "from");
  const to = readInstantFilter(searchParams, "to");
  if (from === "invalid" || to === "invalid" || from === undefined || to === undefined) {
    return { ok: false };
  }
  if (Date.parse(from) >= Date.parse(to)) {
    return { ok: false };
  }
  const locationId = readUuidFilter(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const employeeId = readUuidFilter(searchParams, "employeeId");
  if (employeeId === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      ...(locationId === undefined ? {} : { locationId }),
      ...(employeeId === undefined ? {} : { employeeId }),
    },
  };
}

export interface ShiftRow {
  readonly id: string;
  readonly locationId: string;
  /** `DEC-151` staffing position; `null` means any position. */
  readonly positionId: string | null;
  readonly roleCode: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly state: string;
  readonly publishedAt: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one shift to an HTTP row; `undefined` for a foreign-organization row. */
export function toShiftRow(organizationId: string, shift: ShiftRecord): ShiftRow | undefined {
  if (shift.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: shift.id,
    locationId: shift.locationId,
    positionId: shift.positionId,
    roleCode: shift.roleCode,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    breakMinutes: shift.breakMinutes,
    state: shift.state,
    publishedAt: shift.publishedAt,
    actualStart: shift.actualStart,
    actualEnd: shift.actualEnd,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}

/** Maps shift records to HTTP rows, dropping any foreign-organization shift. */
export function toShiftRows(
  organizationId: string,
  shifts: readonly ShiftRecord[],
): readonly ShiftRow[] {
  const rows: ShiftRow[] = [];
  for (const shift of shifts) {
    const row = toShiftRow(organizationId, shift);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface ShiftAssignmentRow {
  readonly id: string;
  readonly shiftId: string;
  readonly employeeId: string;
  readonly state: string;
  readonly assignedBy: string | null;
  readonly assignedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one assignment to an HTTP row; `undefined` for a foreign-organization row. */
export function toShiftAssignmentRow(
  organizationId: string,
  assignment: ShiftAssignmentRecord,
): ShiftAssignmentRow | undefined {
  if (assignment.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: assignment.id,
    shiftId: assignment.shiftId,
    employeeId: assignment.employeeId,
    state: assignment.state,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

/** Maps assignment records to HTTP rows, dropping any foreign-organization assignment. */
export function toShiftAssignmentRows(
  organizationId: string,
  assignments: readonly ShiftAssignmentRecord[],
): readonly ShiftAssignmentRow[] {
  const rows: ShiftAssignmentRow[] = [];
  for (const assignment of assignments) {
    const row = toShiftAssignmentRow(organizationId, assignment);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * One of the signed-in employee's own shifts (`WF-003`, `DEC-146`). The
 * application read is already scoped to the resolved employee and organization
 * (`DEC-061`), so the mapper is a straight projection with no organization field
 * to drop.
 */
export interface MyShiftRow {
  readonly assignmentId: string;
  readonly assignmentState: string;
  readonly assignedAt: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly shiftState: string;
}

/** Maps one `My shifts` row to the wire shape. */
export function toMyShiftRow(row: SchedulingMyShiftRow): MyShiftRow {
  return {
    assignmentId: row.assignmentId,
    assignmentState: row.assignmentState,
    assignedAt: row.assignedAt,
    shiftId: row.shiftId,
    locationId: row.locationId,
    roleCode: row.roleCode,
    positionId: row.positionId,
    positionName: row.positionName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    breakMinutes: row.breakMinutes,
    shiftState: row.shiftState,
  };
}

/** One available shift for the signed-in employee (`DEC-151`). */
export interface AvailableShiftRow {
  readonly shiftId: string;
  readonly locationId: string;
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly shiftState: string;
}

/** Maps one available shift to the wire shape. */
export function toAvailableShiftRow(row: SchedulingAvailableShiftRow): AvailableShiftRow {
  return {
    shiftId: row.shiftId,
    locationId: row.locationId,
    positionId: row.positionId,
    positionName: row.positionName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    breakMinutes: row.breakMinutes,
    shiftState: row.shiftState,
  };
}

/** Maps available shift rows to the wire shape. */
export function toAvailableShiftRows(
  rows: readonly SchedulingAvailableShiftRow[],
): readonly AvailableShiftRow[] {
  return rows.map(toAvailableShiftRow);
}

/** Maps `My shifts` rows to the wire shape. */
export function toMyShiftRows(rows: readonly SchedulingMyShiftRow[]): readonly MyShiftRow[] {
  return rows.map(toMyShiftRow);
}

/** One self-originated pending assignment in the manager review queue (`DEC-146`). */
export interface PendingSelfAssignmentRow {
  readonly assignmentId: string;
  readonly assignedAt: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
}

/** Maps one pending self-assignment row to the wire shape. */
export function toPendingSelfAssignmentRow(
  row: SchedulingPendingSelfAssignmentRow,
): PendingSelfAssignmentRow {
  return {
    assignmentId: row.assignmentId,
    assignedAt: row.assignedAt,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    shiftId: row.shiftId,
    locationId: row.locationId,
    roleCode: row.roleCode,
    positionId: row.positionId,
    positionName: row.positionName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    breakMinutes: row.breakMinutes,
  };
}

/** Maps pending self-assignment rows to the wire shape. */
export function toPendingSelfAssignmentRows(
  rows: readonly SchedulingPendingSelfAssignmentRow[],
): readonly PendingSelfAssignmentRow[] {
  return rows.map(toPendingSelfAssignmentRow);
}

export interface ShiftAdjustmentRow {
  readonly id: string;
  readonly shiftAssignmentId: string;
  readonly adjustedHours: string;
  readonly reason: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

/** Maps one shift adjustment to an HTTP row; `undefined` for a foreign-organization row. */
export function toShiftAdjustmentRow(
  organizationId: string,
  adjustment: ShiftAdjustmentRecord,
): ShiftAdjustmentRow | undefined {
  if (adjustment.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: adjustment.id,
    shiftAssignmentId: adjustment.shiftAssignmentId,
    adjustedHours: adjustment.adjustedHours,
    reason: adjustment.reason,
    approvedBy: adjustment.approvedBy,
    approvedAt: adjustment.approvedAt,
    createdAt: adjustment.createdAt,
  };
}

/** Maps adjustment records to HTTP rows, dropping any foreign-organization adjustment. */
export function toShiftAdjustmentRows(
  organizationId: string,
  adjustments: readonly ShiftAdjustmentRecord[],
): readonly ShiftAdjustmentRow[] {
  const rows: ShiftAdjustmentRow[] = [];
  for (const adjustment of adjustments) {
    const row = toShiftAdjustmentRow(organizationId, adjustment);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/* ------------------------------ payroll reports --------------------------- */

/**
 * Query/body parsing and row mapping for the monthly payroll-input report
 * (`WF-005`, row 14b-2), kept beside the shift parsers so the slice has one
 * wire-shape module.
 *
 * The report's period is calendar days (`period_start`/`period_end` are `date`
 * columns), so `periodStart`/`periodEnd`/`periodStartFrom` are `YYYY-MM-DD`
 * checked with the shared `isDate` helper and the `periodEnd > periodStart`
 * window is enforced here (the command re-validates). The `status` vocabulary is
 * checked against `PAYROLL_REPORT_STATUSES` so `?status=bogus` is a 400 rather
 * than a silently empty page. The row mappers drop a foreign-organization row
 * defensively, like the other slices, even though the application reads are
 * already organization-scoped (`DEC-061`).
 */

/** An optional `YYYY-MM-DD` filter: absent → `undefined`; malformed → `"invalid"`. */
function readDateFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && isDate(value) ? value : "invalid";
}

export interface PayrollReportListQuery {
  /** One of `PAYROLL_REPORT_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `periodStart`; a `YYYY-MM-DD` day. */
  readonly periodStartFrom?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedPayrollReportListQuery =
  { readonly ok: true; readonly query: PayrollReportListQuery } | { readonly ok: false };

/** Parses the optional `status`/`periodStartFrom` filters and `limit`/`offset` paging. */
export function parsePayrollReportListQuery(
  searchParams: URLSearchParams,
): ParsedPayrollReportListQuery {
  const status = readVocabFilter(searchParams, "status", PAYROLL_REPORT_STATUSES);
  if (status === "invalid") {
    return { ok: false };
  }
  const periodStartFrom = readDateFilter(searchParams, "periodStartFrom");
  if (periodStartFrom === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_PAYROLL_REPORT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(status === undefined ? {} : { status }),
      ...(periodStartFrom === undefined ? {} : { periodStartFrom }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface GeneratePayrollReportBody {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export type ParsedGeneratePayrollReport =
  { readonly ok: true; readonly input: GeneratePayrollReportBody } | { readonly ok: false };

/**
 * `POST /payroll-reports` body: the two calendar days of the period. Both must be
 * real `YYYY-MM-DD` days and `periodEnd` must be strictly after `periodStart`
 * (the report's half-open month); an equal or inverted pair is a 400.
 */
export function parseGeneratePayrollReportBody(
  body: Record<string, unknown> | undefined,
): ParsedGeneratePayrollReport {
  if (body === undefined) {
    return { ok: false };
  }
  const periodStart = readOptionalDate(body, "periodStart");
  const periodEnd = readOptionalDate(body, "periodEnd");
  if (
    !periodStart.ok ||
    !periodStart.present ||
    periodStart.value === null ||
    !periodEnd.ok ||
    !periodEnd.present ||
    periodEnd.value === null
  ) {
    return { ok: false };
  }
  if (periodEnd.value <= periodStart.value) {
    return { ok: false };
  }
  return { ok: true, input: { periodStart: periodStart.value, periodEnd: periodEnd.value } };
}

export interface MarkPayrollReportExportedBody {
  readonly exportFileId?: string;
}

export type ParsedMarkPayrollReportExported =
  { readonly ok: true; readonly input: MarkPayrollReportExportedBody } | { readonly ok: false };

/**
 * `POST /payroll-reports/[id]/export` body: the whole body is optional, so an
 * absent body (or one without `exportFileId`) marks the report exported with no
 * file link. A present `exportFileId` must be a UUID; `null`, a blank string or
 * any other value is a 400 rather than a silently ignored field.
 */
export function parseMarkPayrollReportExportedBody(
  body: Record<string, unknown> | undefined,
): ParsedMarkPayrollReportExported {
  if (body === undefined || body["exportFileId"] === undefined) {
    return { ok: true, input: {} };
  }
  const exportFileId = readText(body, "exportFileId", 64);
  if (exportFileId === null || !isUuid(exportFileId)) {
    return { ok: false };
  }
  return { ok: true, input: { exportFileId } };
}

export interface PayrollReportRow {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly generatedBy: string | null;
  readonly status: string;
  readonly snapshot: unknown;
  readonly exportFileId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one payroll report to an HTTP row; `undefined` for a foreign-organization row. */
export function toPayrollReportRow(
  organizationId: string,
  report: PayrollReportRecord,
): PayrollReportRow | undefined {
  if (report.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: report.id,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy,
    status: report.status,
    snapshot: report.snapshot,
    exportFileId: report.exportFileId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

/** Maps payroll report records to HTTP rows, dropping any foreign-organization report. */
export function toPayrollReportRows(
  organizationId: string,
  reports: readonly PayrollReportRecord[],
): readonly PayrollReportRow[] {
  const rows: PayrollReportRow[] = [];
  for (const report of reports) {
    const row = toPayrollReportRow(organizationId, report);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/* -------------------------------- positions ------------------------------- */

/**
 * Query/body parsing and row mapping for the position catalogue (`DEC-151`).
 * `code`/`name` are bounded free text (the catalogue is open, unlike the role
 * vocabulary); `activeFrom`/`activeTo` are `YYYY-MM-DD` days. The row mapper
 * drops a foreign-organization row defensively, like the other slices.
 */

export interface PositionListQuery {
  /** `true` = active now; `false` = expired; absent = all. */
  readonly active?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedPositionListQuery =
  { readonly ok: true; readonly query: PositionListQuery } | { readonly ok: false };

/** Parses the optional `active` filter and `limit`/`offset` paging. */
export function parsePositionListQuery(searchParams: URLSearchParams): ParsedPositionListQuery {
  const active = readOptionalQueryBoolean(searchParams, "active");
  if (active === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_POSITION_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(active === undefined ? {} : { active }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface CreatePositionBody {
  readonly code: string;
  readonly name: string;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export type ParsedCreatePosition =
  { readonly ok: true; readonly input: CreatePositionBody } | { readonly ok: false };

/** `POST /positions` body: the code, name and effective window. */
export function parseCreatePositionBody(
  body: Record<string, unknown> | undefined,
): ParsedCreatePosition {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code");
  const name = readText(body, "name");
  const activeFrom = readOptionalDate(body, "activeFrom");
  if (
    code === null ||
    name === null ||
    !activeFrom.ok ||
    !activeFrom.present ||
    activeFrom.value === null
  ) {
    return { ok: false };
  }
  const activeTo = readOptionalDate(body, "activeTo");
  if (!activeTo.ok) {
    return { ok: false };
  }
  if (activeTo.value !== null && activeTo.value <= activeFrom.value) {
    return { ok: false };
  }
  return {
    ok: true,
    input: { code, name, activeFrom: activeFrom.value, activeTo: activeTo.value },
  };
}

export interface UpdatePositionBody {
  readonly code?: string;
  readonly name?: string;
  readonly activeFrom?: string;
  readonly activeTo?: string | null;
}

export type ParsedUpdatePosition =
  { readonly ok: true; readonly input: UpdatePositionBody } | { readonly ok: false };

/** `PATCH /positions/[id]` body: any subset; `activeTo` deactivates/reactivates. */
export function parseUpdatePositionBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdatePosition {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readOptionalRequiredText(body, "code");
  const name = readOptionalRequiredText(body, "name");
  const activeFrom = readOptionalDate(body, "activeFrom");
  const activeTo = readOptionalDate(body, "activeTo");
  if (!code.ok || !name.ok || !activeFrom.ok || !activeTo.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(code.present ? { code: code.value } : {}),
      ...(name.present ? { name: name.value } : {}),
      ...(activeFrom.present && activeFrom.value !== null ? { activeFrom: activeFrom.value } : {}),
      ...(activeTo.present ? { activeTo: activeTo.value } : {}),
    },
  };
}

export interface PositionRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly activeFrom: string;
  readonly activeTo: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one position to an HTTP row; `undefined` for a foreign-organization row. */
export function toPositionRow(
  organizationId: string,
  position: PositionRecord,
): PositionRow | undefined {
  if (position.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: position.id,
    code: position.code,
    name: position.name,
    activeFrom: position.activeFrom,
    activeTo: position.activeTo,
    createdAt: position.createdAt,
    createdBy: position.createdBy,
  };
}

/** Maps position records to HTTP rows, dropping any foreign-organization position. */
export function toPositionRows(
  organizationId: string,
  positions: readonly PositionRecord[],
): readonly PositionRow[] {
  const rows: PositionRow[] = [];
  for (const position of positions) {
    const row = toPositionRow(organizationId, position);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
