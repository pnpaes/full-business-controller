import {
  DEFAULT_SALES_REPORT_RECORD_LIMIT,
  SALES_REPORT_GROUP_BYS,
  type SalesReportGroupBy,
} from "@aquarela/application";
import { SALES_REPORT_GRAINS, type SalesReportGrain } from "@aquarela/domain";

import { isUuid } from "../hms/hms-rows";

/**
 * Pure query parsing for the reporting routes (`RPT-001`–`RPT-003`, `RPT-005`).
 * Kept free of Next, DB and I/O imports so the routes do the reads and hand the
 * parsed query to the application.
 *
 * Shape checks only, but they are the *same* vocabularies the application uses
 * (`SALES_REPORT_GRAINS` from the domain, `SALES_REPORT_GROUP_BYS` from the
 * application), so an unknown `grain`/`groupBy` is a 400 rather than a silently
 * empty page. `from`/`to` must be full ISO-8601 instants (`timestamptz` shaped)
 * with `from <= to` (inclusive bounds); the application re-validates.
 */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 500;
const MAX_OFFSET = 500;
const MAX_CATEGORY = 200;

/** True when `value` is a full ISO-8601 instant (`timestamptz` shaped). */
function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/** An optional trimmed value: absent → `undefined`; blank → `"invalid"`. */
function readOptionalText(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : "invalid";
}

/** An optional UUID filter: absent → `undefined`; malformed → `"invalid"`. */
function readOptionalUuid(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const value = readOptionalText(searchParams, key);
  if (value === undefined || value === "invalid") {
    return value;
  }
  return isUuid(value) ? value : "invalid";
}

/**
 * An optional comma-separated UUID list: absent → `undefined`; a blank element
 * or any malformed UUID → `"invalid"`. Used for the caller's location scope on
 * the drill-down (`locationIds=a,b`), so a multi-location caller can pass the
 * whole scope the summary was read with.
 */
function readOptionalUuidList(
  searchParams: URLSearchParams,
  key: string,
): readonly string[] | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0 || !isUuid(part))) {
    return "invalid";
  }
  return parts;
}

/** An optional vocabulary member: absent → `undefined`; non-member → `"invalid"`. */
function readOptionalVocab(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[],
): string | undefined | "invalid" {
  const value = readOptionalText(searchParams, key);
  if (value === undefined || value === "invalid") {
    return value;
  }
  return values.includes(value) ? value : "invalid";
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

export interface SalesReportQuery {
  readonly from: string;
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly groupBy: SalesReportGroupBy;
  readonly locationId?: string;
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
}

export type ParsedSalesReportQuery =
  { readonly ok: true; readonly query: SalesReportQuery } | { readonly ok: false };

/** Parses the required period/grain/groupBy and the optional dimension filters. */
export function parseSalesReportQuery(searchParams: URLSearchParams): ParsedSalesReportQuery {
  const from = readOptionalText(searchParams, "from");
  const to = readOptionalText(searchParams, "to");
  if (
    from === undefined ||
    from === "invalid" ||
    to === undefined ||
    to === "invalid" ||
    !isIsoInstant(from) ||
    !isIsoInstant(to) ||
    Date.parse(from) > Date.parse(to)
  ) {
    return { ok: false };
  }
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  const groupBy = readOptionalVocab(searchParams, "groupBy", SALES_REPORT_GROUP_BYS);
  if (
    grain === undefined ||
    grain === "invalid" ||
    groupBy === undefined ||
    groupBy === "invalid"
  ) {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  const channelId = readOptionalUuid(searchParams, "channelId");
  const productVariantId = readOptionalUuid(searchParams, "productVariantId");
  if (locationId === "invalid" || channelId === "invalid" || productVariantId === "invalid") {
    return { ok: false };
  }
  const category = readOptionalText(searchParams, "category");
  if (category === "invalid" || (category !== undefined && category.length > MAX_CATEGORY)) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      grain: grain as SalesReportGrain,
      groupBy: groupBy as SalesReportGroupBy,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(category === undefined ? {} : { category }),
      ...(productVariantId === undefined ? {} : { productVariantId }),
    },
  };
}

export interface SalesReportRecordsQuery {
  readonly from: string;
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly locationId?: string;
  /**
   * The caller's location scope as a comma-separated UUID list, so a
   * multi-location caller can drill into the same scope the summary was read
   * with. Narrower than the caller's scope? It must be a subset.
   */
  readonly locationIds?: readonly string[];
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedSalesReportRecordsQuery =
  { readonly ok: true; readonly query: SalesReportRecordsQuery } | { readonly ok: false };

/**
 * Parses the drill-down query: the same dimension filters plus a `locationIds`
 * list and bounded `limit`/`offset`. `groupBy` is deliberately **not** parsed —
 * the drill-down does not group, and the parameter was validated then dropped.
 */
export function parseSalesReportRecordsQuery(
  searchParams: URLSearchParams,
): ParsedSalesReportRecordsQuery {
  const from = readOptionalText(searchParams, "from");
  const to = readOptionalText(searchParams, "to");
  if (
    from === undefined ||
    from === "invalid" ||
    to === undefined ||
    to === "invalid" ||
    !isIsoInstant(from) ||
    !isIsoInstant(to) ||
    Date.parse(from) > Date.parse(to)
  ) {
    return { ok: false };
  }
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  if (grain === undefined || grain === "invalid") {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  const locationIds = readOptionalUuidList(searchParams, "locationIds");
  const channelId = readOptionalUuid(searchParams, "channelId");
  const productVariantId = readOptionalUuid(searchParams, "productVariantId");
  if (
    locationId === "invalid" ||
    locationIds === "invalid" ||
    channelId === "invalid" ||
    productVariantId === "invalid"
  ) {
    return { ok: false };
  }
  const category = readOptionalText(searchParams, "category");
  if (category === "invalid" || (category !== undefined && category.length > MAX_CATEGORY)) {
    return { ok: false };
  }
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (
    limit === "invalid" ||
    offset === "invalid" ||
    (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) ||
    (offset !== undefined && offset > MAX_OFFSET)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      grain: grain as SalesReportGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(locationIds === undefined ? {} : { locationIds }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(category === undefined ? {} : { category }),
      ...(productVariantId === undefined ? {} : { productVariantId }),
      limit: limit ?? DEFAULT_SALES_REPORT_RECORD_LIMIT,
      offset: offset ?? 0,
    },
  };
}

export interface MenuEngineeringQuery {
  readonly from: string;
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly locationId?: string;
  readonly channelId?: string;
}

export type ParsedMenuEngineeringQuery =
  { readonly ok: true; readonly query: MenuEngineeringQuery } | { readonly ok: false };

/**
 * Parses the menu-engineering query (`RPT-005`): the required inclusive
 * `from`/`to` ISO instants, `grain` and the optional `locationId`/`channelId`
 * filters. There is no `groupBy` (the report is always per product) and no
 * `category`/`productVariantId` filter.
 */
export function parseMenuEngineeringQuery(
  searchParams: URLSearchParams,
): ParsedMenuEngineeringQuery {
  const from = readOptionalText(searchParams, "from");
  const to = readOptionalText(searchParams, "to");
  if (
    from === undefined ||
    from === "invalid" ||
    to === undefined ||
    to === "invalid" ||
    !isIsoInstant(from) ||
    !isIsoInstant(to) ||
    Date.parse(from) > Date.parse(to)
  ) {
    return { ok: false };
  }
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  if (grain === undefined || grain === "invalid") {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  const channelId = readOptionalUuid(searchParams, "channelId");
  if (locationId === "invalid" || channelId === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      grain: grain as SalesReportGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
    },
  };
}
