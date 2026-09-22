import {
  ADJUSTMENT_PERIOD_STATUSES,
  DEFAULT_ADJUSTMENT_PERIOD_LIMIT,
  type AdjustmentPeriodRecord,
} from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

export { isUuid };

/**
 * Pure query/body parsing and response mapping for the adjustment-period routes
 * (`REC-006`, `DEC-027`, row 13b). Kept free of Next, DB and I/O imports so the
 * routes do the reads and hand the application results to the row mappers.
 *
 * The parsers do shape checks only where the value would otherwise reach a
 * Postgres column directly: `openedFrom`/`openedTo`/`from`/`to` are `YYYY-MM-DD`
 * calendar-checked and `status` is checked against the same application
 * vocabulary the command uses (so `?status=bogus` is a 400 rather than a silently
 * empty page). The row mapper drops a foreign-organization row defensively, like
 * the other slices, even though the application reads are already
 * organization-scoped (`DEC-061`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_VOCAB = 32;
const MAX_REASON = 1000;

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
  return { ok: true, limit: limit ?? DEFAULT_ADJUSTMENT_PERIOD_LIMIT, offset: offset ?? 0 };
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

function readText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/* --------------------------------- queries -------------------------------- */

export interface AdjustmentPeriodListQuery {
  /** One of `ADJUSTMENT_PERIOD_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `openedFrom`; a `YYYY-MM-DD` day. */
  readonly from?: string;
  /** Inclusive upper bound on `openedFrom`; a `YYYY-MM-DD` day. */
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedAdjustmentPeriodListQuery =
  { readonly ok: true; readonly query: AdjustmentPeriodListQuery } | { readonly ok: false };

/** Parses the optional status/period filters and `limit`/`offset` paging. */
export function parseListAdjustmentPeriodsQuery(
  searchParams: URLSearchParams,
): ParsedAdjustmentPeriodListQuery {
  const status = readVocabFilter(searchParams, "status", ADJUSTMENT_PERIOD_STATUSES);
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
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface OpenAdjustmentPeriodBody {
  /** `date`, `YYYY-MM-DD`. */
  readonly openedFrom: string;
  /** `date`, `YYYY-MM-DD`; `>= openedFrom`. */
  readonly openedTo: string;
  readonly reason: string;
}

export type ParsedOpenAdjustmentPeriod =
  { readonly ok: true; readonly input: OpenAdjustmentPeriodBody } | { readonly ok: false };

/**
 * `POST /adjustment-periods` body: the window (`openedFrom`/`openedTo`, both
 * `YYYY-MM-DD`) and a required non-empty `reason`. A missing/malformed date, an
 * inverted window or a blank/over-long reason is a 400; the command re-validates
 * the window and the reason (a 400 there too).
 */
export function parseOpenAdjustmentPeriodBody(
  body: Record<string, unknown> | undefined,
): ParsedOpenAdjustmentPeriod {
  if (body === undefined) {
    return { ok: false };
  }
  const openedFrom = readText(body, "openedFrom", 32);
  if (openedFrom === null || !isDate(openedFrom)) {
    return { ok: false };
  }
  const openedTo = readText(body, "openedTo", 32);
  if (openedTo === null || !isDate(openedTo) || openedTo < openedFrom) {
    return { ok: false };
  }
  const reason = readText(body, "reason", MAX_REASON);
  if (reason === null) {
    return { ok: false };
  }
  return { ok: true, input: { openedFrom, openedTo, reason } };
}

/* ------------------------------ response rows ----------------------------- */

export interface AdjustmentPeriodRow {
  readonly id: string;
  readonly openedFrom: string;
  readonly openedTo: string;
  readonly reason: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one adjustment period to an HTTP row; `undefined` for a foreign-organization row. */
export function toAdjustmentPeriodRow(
  organizationId: string,
  period: AdjustmentPeriodRecord,
): AdjustmentPeriodRow | undefined {
  if (period.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: period.id,
    openedFrom: period.openedFrom,
    openedTo: period.openedTo,
    reason: period.reason,
    approvedBy: period.approvedBy,
    approvedAt: period.approvedAt,
    status: period.status,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
  };
}

/** Maps adjustment-period records to HTTP rows, dropping any foreign-organization row. */
export function toAdjustmentPeriodRows(
  organizationId: string,
  periods: readonly AdjustmentPeriodRecord[],
): readonly AdjustmentPeriodRow[] {
  const rows: AdjustmentPeriodRow[] = [];
  for (const period of periods) {
    const row = toAdjustmentPeriodRow(organizationId, period);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
