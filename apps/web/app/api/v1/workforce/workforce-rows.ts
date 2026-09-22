import {
  DEFAULT_EMPLOYEE_DOCUMENT_LIMIT,
  DEFAULT_EMPLOYEE_LIMIT,
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYMENT_TYPES,
  type EmployeeDocumentRecord,
  type EmployeeRecord,
} from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

export { isUuid };

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
/** A plain non-negative decimal at most four places (`numeric(19,4)` money). */
const MONEY = /^\d+(?:\.\d{1,4})?$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_VOCAB = 32;
const MAX_MONEY = 64;

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
  if (!userId.ok || !costCenterId.ok || !primaryLocationId.ok || !activeTo.ok) {
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
  if (
    !name.ok ||
    !roleCode.ok ||
    !employmentType.ok ||
    !baseHourlyRate.ok ||
    !costCenterId.ok ||
    !primaryLocationId.ok ||
    !activeTo.ok
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
