import {
  DEFAULT_PERIOD_CLOSE_LIMIT,
  PERIOD_CLOSE_SCOPE_TYPES,
  PERIOD_CLOSE_STATUSES,
  type PeriodCloseRecord,
} from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

export { isUuid };

/**
 * Pure query/body parsing and response mapping for the close/lock routes
 * (`REC-003`, `REC-006`, `DEC-027`, row 13a). Kept free of Next, DB and I/O
 * imports so the routes do the reads and hand the application results to the row
 * mappers.
 *
 * The parsers do shape checks only where the value would otherwise reach a
 * Postgres column directly: `periodStart`/`from`/`to` are `YYYY-MM-DD`
 * calendar-checked, `scopeType`/`status` are checked against the same
 * application vocabularies the commands use (so `?status=bogus` is a 400 rather
 * than a silently empty page) and `scopeId` is a UUID. The `checklist` body is
 * passed through as `unknown` — `beginPeriodClose` owns its deep validation — so
 * only a missing value is defaulted to `[]` here. The row mappers drop a
 * foreign-organization row defensively, like the other slices, even though the
 * application reads are already organization-scoped (`DEC-061`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_REASON = 1000;
const MAX_VOCAB = 32;

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

/** Parses `limit`/`offset`; both are bounded so a huge `offset` cannot be passed to the store. */
function readPaging(
  searchParams: URLSearchParams,
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
  return { ok: true, limit: limit ?? DEFAULT_PERIOD_CLOSE_LIMIT, offset: offset ?? 0 };
}

/** True when `value` is a real `YYYY-MM-DD` day (`date` column shaped). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Optional fixed-vocabulary filter: absent → `undefined`; a non-member → `"invalid"`. */
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

/** Optional `YYYY-MM-DD` filter: absent → `undefined`; malformed → `"invalid"`. */
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

/** Optional uuid filter: absent → `undefined`; non-uuid → `"invalid"`. */
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

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/* --------------------------------- queries -------------------------------- */

export interface PeriodCloseListQuery {
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`, exact match. */
  readonly scopeType?: string;
  readonly scopeId?: string;
  /** One of `PERIOD_CLOSE_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `periodStart`; a `YYYY-MM-DD` day. */
  readonly from?: string;
  /** Inclusive upper bound on `periodStart`; a `YYYY-MM-DD` day. */
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedPeriodCloseListQuery =
  { readonly ok: true; readonly query: PeriodCloseListQuery } | { readonly ok: false };

/** Parses the optional scope/status/period filters and `limit`/`offset` paging. */
export function parseListPeriodClosesQuery(
  searchParams: URLSearchParams,
): ParsedPeriodCloseListQuery {
  const scopeType = readVocabFilter(searchParams, "scopeType", PERIOD_CLOSE_SCOPE_TYPES);
  if (scopeType === "invalid") {
    return { ok: false };
  }
  const scopeId = readUuidFilter(searchParams, "scopeId");
  if (scopeId === "invalid") {
    return { ok: false };
  }
  const status = readVocabFilter(searchParams, "status", PERIOD_CLOSE_STATUSES);
  if (status === "invalid") {
    return { ok: false };
  }
  const from = readDateFilter(searchParams, "from");
  if (from === "invalid") {
    return { ok: false };
  }
  const to = readDateFilter(searchParams, "to");
  if (to === "invalid") {
    return { ok: false };
  }
  if (from !== undefined && to !== undefined && from > to) {
    return { ok: false };
  }
  const paging = readPaging(searchParams);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(scopeType === undefined ? {} : { scopeType }),
      ...(scopeId === undefined ? {} : { scopeId }),
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface BeginPeriodCloseBody {
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: string;
  /** The `location.id` (location scope) or `organization.id` (company scope). */
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** The close-task list; deep-validated by `beginPeriodClose`. */
  readonly checklist: unknown;
}

export type ParsedBeginPeriodClose =
  { readonly ok: true; readonly input: BeginPeriodCloseBody } | { readonly ok: false };

/**
 * `POST /period-closes` body: the scope (`scopeType` + `scopeId`), the period
 * start and an optional `checklist` array (defaulting to `[]`). A missing/blank
 * `scopeType`/`scopeId`/`periodStart`, a non-member `scopeType` or a non-UUID
 * `scopeId` is a 400; the day's validity and the scope/period consistency are
 * re-checked by `resolveClosePeriod` (a 400 there too).
 */
export function parseBeginPeriodCloseBody(
  body: Record<string, unknown> | undefined,
): ParsedBeginPeriodClose {
  if (body === undefined) {
    return { ok: false };
  }
  const rawScopeType = readText(body, "scopeType", MAX_VOCAB);
  if (rawScopeType === null || !PERIOD_CLOSE_SCOPE_TYPES.includes(rawScopeType)) {
    return { ok: false };
  }
  const scopeId = readText(body, "scopeId", 64);
  if (scopeId === null || !isUuid(scopeId)) {
    return { ok: false };
  }
  const periodStart = readText(body, "periodStart", 32);
  if (periodStart === null || !isDate(periodStart)) {
    return { ok: false };
  }
  const checklist = body["checklist"] === undefined ? [] : body["checklist"];
  if (!Array.isArray(checklist)) {
    return { ok: false };
  }
  return { ok: true, input: { scopeType: rawScopeType, scopeId, periodStart, checklist } };
}

export interface ReopenPeriodCloseBody {
  readonly reason: string;
}

export type ParsedReopenPeriodClose =
  { readonly ok: true; readonly input: ReopenPeriodCloseBody } | { readonly ok: false };

/**
 * `POST /period-closes/[id]/reopen` body: the required, non-empty `reason`. A
 * missing body, a non-string reason or a blank/over-long one is a 400.
 */
export function parseReopenBody(
  body: Record<string, unknown> | undefined,
): ParsedReopenPeriodClose {
  if (body === undefined) {
    return { ok: false };
  }
  const reason = readText(body, "reason", MAX_REASON);
  if (reason === null) {
    return { ok: false };
  }
  return { ok: true, input: { reason } };
}

/* ------------------------------ response rows ----------------------------- */

export interface PeriodCloseRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
  readonly checklist: unknown;
  readonly snapshot: unknown;
  readonly correctionPolicy: string | null;
  readonly lockedBy: string | null;
  readonly lockedAt: string | null;
  readonly reopenedBy: string | null;
  readonly reopenedAt: string | null;
  readonly reopenReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one close to an HTTP row; `undefined` for a foreign-organization row. */
export function toPeriodCloseRow(
  organizationId: string,
  close: PeriodCloseRecord,
): PeriodCloseRow | undefined {
  if (close.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: close.id,
    scopeType: close.scopeType,
    scopeId: close.scopeId,
    periodStart: close.periodStart,
    periodEnd: close.periodEnd,
    status: close.status,
    checklist: close.checklist,
    snapshot: close.snapshot,
    correctionPolicy: close.correctionPolicy,
    lockedBy: close.lockedBy,
    lockedAt: close.lockedAt,
    reopenedBy: close.reopenedBy,
    reopenedAt: close.reopenedAt,
    reopenReason: close.reopenReason,
    createdAt: close.createdAt,
    updatedAt: close.updatedAt,
  };
}

/** Maps close records to HTTP rows, dropping any foreign-organization close. */
export function toPeriodCloseRows(
  organizationId: string,
  closes: readonly PeriodCloseRecord[],
): readonly PeriodCloseRow[] {
  const rows: PeriodCloseRow[] = [];
  for (const close of closes) {
    const row = toPeriodCloseRow(organizationId, close);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
