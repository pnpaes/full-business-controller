import {
  ANALYTICS_MAX_PERIODS,
  ANALYTICS_METRICS,
  BENCHMARK_DIMENSIONS,
  BENCHMARK_METRICS,
  SUPPORTED_FORECAST_GRAINS,
  type AnalyticsMetric,
  type BenchmarkDimension,
  type BenchmarkMetric,
  type SupportedForecastGrain,
} from "@aquarela/application";
import { SALES_REPORT_GRAINS, type SalesReportGrain } from "@aquarela/domain";

import { isUuid } from "../hms/hms-rows";

/**
 * Pure query parsing for the analytics routes (`W6`). Kept free of Next, DB and
 * I/O imports so the routes do the reads and hand the parsed query to the
 * application. Shape checks only, but they are the **same** vocabularies the
 * application uses (`ANALYTICS_METRICS`, `BENCHMARK_METRICS`,
 * `BENCHMARK_DIMENSIONS`, `SALES_REPORT_GRAINS`), so an unknown metric/dimension
 * is a 400 rather than a silently empty result.
 */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

/** A bounded positive integer: absent → `undefined`; out of `[min, max]` → `"invalid"`. */
function readBoundedInteger(
  raw: string | null,
  max: number,
  min = 1,
): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  const parsed = Number.parseInt(value, 10);
  return parsed >= min && parsed <= max ? parsed : "invalid";
}

/** The `[from, to]` pair shared by the period-bounded queries. */
interface PeriodQuery {
  readonly from: string;
  readonly to: string;
}

/** Reads a required `from`/`to` pair with `from <= to`; `null` when malformed. */
function readPeriod(searchParams: URLSearchParams): PeriodQuery | null {
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
    return null;
  }
  return { from, to };
}

export interface TrendsQuery {
  readonly metric: AnalyticsMetric;
  readonly grain: SalesReportGrain;
  readonly locationId?: string;
  readonly channelId?: string;
  readonly periods?: number;
}

export type ParsedTrendsQuery =
  { readonly ok: true; readonly query: TrendsQuery } | { readonly ok: false };

/** Parses the trends query: required `metric` and `grain`, optional filters. */
export function parseTrendsQuery(searchParams: URLSearchParams): ParsedTrendsQuery {
  const metric = readOptionalVocab(searchParams, "metric", ANALYTICS_METRICS);
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  if (metric === undefined || metric === "invalid" || grain === undefined || grain === "invalid") {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  const channelId = readOptionalUuid(searchParams, "channelId");
  const periods = readBoundedInteger(searchParams.get("periods"), ANALYTICS_MAX_PERIODS);
  if (locationId === "invalid" || channelId === "invalid" || periods === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      metric: metric as AnalyticsMetric,
      grain: grain as SalesReportGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(periods === undefined ? {} : { periods }),
    },
  };
}

export interface BenchmarksQuery {
  readonly dimension: BenchmarkDimension;
  readonly metric: BenchmarkMetric;
  readonly from: string;
  readonly to: string;
  readonly locationId?: string;
}

export type ParsedBenchmarksQuery =
  { readonly ok: true; readonly query: BenchmarksQuery } | { readonly ok: false };

/** Parses the benchmarks query: required `dimension`, `metric` and period. */
export function parseBenchmarksQuery(searchParams: URLSearchParams): ParsedBenchmarksQuery {
  const dimension = readOptionalVocab(searchParams, "dimension", BENCHMARK_DIMENSIONS);
  const metric = readOptionalVocab(searchParams, "metric", BENCHMARK_METRICS);
  if (
    dimension === undefined ||
    dimension === "invalid" ||
    metric === undefined ||
    metric === "invalid"
  ) {
    return { ok: false };
  }
  const period = readPeriod(searchParams);
  if (period === null) {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      dimension: dimension as BenchmarkDimension,
      metric: metric as BenchmarkMetric,
      from: period.from,
      to: period.to,
      ...(locationId === undefined ? {} : { locationId }),
    },
  };
}

export interface ForecastQuery {
  readonly metric: AnalyticsMetric;
  readonly grain: SalesReportGrain;
  readonly locationId?: string;
  readonly channelId?: string;
  readonly historyPeriods?: number;
  readonly horizonPeriods?: number;
}

export type ParsedForecastQuery =
  { readonly ok: true; readonly query: ForecastQuery } | { readonly ok: false };

/** Parses the forecast query: required `metric` and `grain`, optional windows. */
export function parseForecastQuery(searchParams: URLSearchParams): ParsedForecastQuery {
  const metric = readOptionalVocab(searchParams, "metric", ANALYTICS_METRICS);
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  if (metric === undefined || metric === "invalid" || grain === undefined || grain === "invalid") {
    return { ok: false };
  }
  const locationId = readOptionalUuid(searchParams, "locationId");
  const channelId = readOptionalUuid(searchParams, "channelId");
  const historyPeriods = readBoundedInteger(
    searchParams.get("historyPeriods"),
    ANALYTICS_MAX_PERIODS,
  );
  const horizonPeriods = readBoundedInteger(
    searchParams.get("horizonPeriods"),
    ANALYTICS_MAX_PERIODS,
  );
  if (
    locationId === "invalid" ||
    channelId === "invalid" ||
    historyPeriods === "invalid" ||
    horizonPeriods === "invalid"
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      metric: metric as AnalyticsMetric,
      grain: grain as SalesReportGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(historyPeriods === undefined ? {} : { historyPeriods }),
      ...(horizonPeriods === undefined ? {} : { horizonPeriods }),
    },
  };
}

export interface SuggestionsQuery {
  readonly from: string;
  readonly to: string;
  readonly grain?: SalesReportGrain;
  readonly trendPeriods?: number;
  readonly locationId?: string;
}

export type ParsedSuggestionsQuery =
  { readonly ok: true; readonly query: SuggestionsQuery } | { readonly ok: false };

/** Parses the suggestions query: a required period plus optional grain/filters. */
export function parseSuggestionsQuery(searchParams: URLSearchParams): ParsedSuggestionsQuery {
  const period = readPeriod(searchParams);
  if (period === null) {
    return { ok: false };
  }
  const grain = readOptionalVocab(searchParams, "grain", SALES_REPORT_GRAINS);
  const locationId = readOptionalUuid(searchParams, "locationId");
  const trendPeriods = readBoundedInteger(
    searchParams.get("trendPeriods"),
    ANALYTICS_MAX_PERIODS,
    2,
  );
  if (grain === "invalid" || locationId === "invalid" || trendPeriods === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      from: period.from,
      to: period.to,
      ...(grain === undefined ? {} : { grain: grain as SalesReportGrain }),
      ...(trendPeriods === undefined ? {} : { trendPeriods }),
      ...(locationId === undefined ? {} : { locationId }),
    },
  };
}

/** The resolved location scope a route applies to the application call. */
export type LocationScopeResolution =
  | { readonly ok: true; readonly locationId: string | undefined }
  | { readonly ok: false; readonly status: 400 | 403; readonly message?: string };

/**
 * Resolves the caller's location scope exactly as the reporting routes do
 * (`worked-hours` precedent): an explicit `locationId` outside the caller's
 * scope is a 403; a single-location caller with no filter is pinned to their
 * location; a multi-location caller with no filter is a 400 (the route refuses
 * to guess rather than silently widening); an unscoped caller sees the whole
 * organization.
 */
export function resolveLocationScope(
  scope: readonly string[],
  locationId: string | undefined,
): LocationScopeResolution {
  if (scope.length === 0) {
    return { ok: true, locationId };
  }
  if (locationId !== undefined && !scope.includes(locationId)) {
    return { ok: false, status: 403 };
  }
  if (locationId === undefined) {
    if (scope.length === 1) {
      return { ok: true, locationId: scope[0] };
    }
    return {
      ok: false,
      status: 400,
      message: "locationId is required for a multi-location caller",
    };
  }
  return { ok: true, locationId };
}

/*
 * Forecast-vs-actual tracking wire shapes (`DEC-011`, `DEC-138`). These are
 * shape checks only: the application commands remain the authority for the
 * `DEC-011` grain ceiling (`SUPPORTED_FORECAST_GRAINS`, only `day_location`), the
 * mandatory override reason and the scope normalisation. The parser refuses an
 * unsupported grain here so the route is a 400 rather than a synthetic empty
 * report, matching the backend's loud refusal.
 */

/** The one grain this surface accepts, used as the default when `grain` is absent. */
const DEFAULT_FORECAST_GRAIN: SupportedForecastGrain = "day_location";

/** A `forecast_override.period` is a day bucket (`YYYY-MM-DD`). */
const DAY_PERIOD = /^\d{4}-\d{2}-\d{2}$/;

export interface ForecastTrackingQuery {
  readonly metric: AnalyticsMetric;
  readonly grain: SupportedForecastGrain;
  readonly locationId?: string;
  readonly channelId?: string;
}

export type ParsedForecastTrackingQuery =
  { readonly ok: true; readonly query: ForecastTrackingQuery } | { readonly ok: false };

/**
 * Parses the tracking query: required `metric`, optional `grain` (defaults to
 * `day_location`), optional `locationId`/`channelId` filters. A grain outside
 * `SUPPORTED_FORECAST_GRAINS` is a 400 — `DEC-011`'s category/product grains are
 * declared but not implemented, so the read refuses rather than mis-scopes.
 */
export function parseForecastTrackingQuery(
  searchParams: URLSearchParams,
): ParsedForecastTrackingQuery {
  const metric = readOptionalVocab(searchParams, "metric", ANALYTICS_METRICS);
  const grain = readOptionalVocab(searchParams, "grain", SUPPORTED_FORECAST_GRAINS);
  if (metric === undefined || metric === "invalid" || grain === "invalid") {
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
      metric: metric as AnalyticsMetric,
      grain: (grain ?? DEFAULT_FORECAST_GRAIN) as SupportedForecastGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
    },
  };
}

/** A required non-empty trimmed body string, bounded by `maxLength`. */
function readBodyString(
  body: Record<string, unknown> | undefined,
  key: string,
  maxLength = 512,
): string | undefined | "invalid" {
  const value = body?.[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > maxLength ? "invalid" : trimmed;
}

/** An optional body vocabulary member: absent/null → `undefined`; non-member → `"invalid"`. */
function readBodyVocab(
  body: Record<string, unknown> | undefined,
  key: string,
  values: readonly string[],
): string | undefined | "invalid" {
  const value = readBodyString(body, key);
  if (value === undefined || value === "invalid") {
    return value;
  }
  return values.includes(value) ? value : "invalid";
}

/** An optional body UUID filter: absent/blank/null → `undefined`; malformed → `"invalid"`. */
function readOptionalBodyUuid(
  body: Record<string, unknown> | undefined,
  key: string,
): string | undefined | "invalid" {
  const value = body?.[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return isUuid(trimmed) ? trimmed : "invalid";
}

/** An optional JSON-number integer in `[min, max]`; absent/null → `undefined`. */
function readOptionalBodyInteger(
  value: unknown,
  max: number,
  min = 1,
): number | undefined | "invalid" {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return "invalid";
  }
  return value >= min && value <= max ? value : "invalid";
}

export interface ForecastSnapshotBody {
  readonly metric: AnalyticsMetric;
  readonly grain: SupportedForecastGrain;
  readonly locationId?: string;
  readonly channelId?: string;
  readonly historyPeriods?: number;
  readonly horizonPeriods?: number;
}

export type ParsedForecastSnapshotBody =
  { readonly ok: true; readonly fields: ForecastSnapshotBody } | { readonly ok: false };

/**
 * Parses the record-snapshot body: required `metric`, optional `grain`
 * (defaults to `day_location`), optional `locationId`/`channelId` (blank reads
 * organization-wide, matching `normalizeForecastScope`) and optional
 * `historyPeriods`/`horizonPeriods` windows bounded like the forecast read.
 */
export function parseForecastSnapshotBody(
  body: Record<string, unknown> | undefined,
): ParsedForecastSnapshotBody {
  const metric = readBodyVocab(body, "metric", ANALYTICS_METRICS);
  if (metric === undefined || metric === "invalid") {
    return { ok: false };
  }
  const grain = readBodyVocab(body, "grain", SUPPORTED_FORECAST_GRAINS);
  if (grain === "invalid") {
    return { ok: false };
  }
  const locationId = readOptionalBodyUuid(body, "locationId");
  const channelId = readOptionalBodyUuid(body, "channelId");
  if (locationId === "invalid" || channelId === "invalid") {
    return { ok: false };
  }
  const historyPeriods = readOptionalBodyInteger(body?.["historyPeriods"], ANALYTICS_MAX_PERIODS);
  const horizonPeriods = readOptionalBodyInteger(body?.["horizonPeriods"], ANALYTICS_MAX_PERIODS);
  if (historyPeriods === "invalid" || horizonPeriods === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    fields: {
      metric: metric as AnalyticsMetric,
      grain: (grain ?? DEFAULT_FORECAST_GRAIN) as SupportedForecastGrain,
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(historyPeriods === undefined ? {} : { historyPeriods }),
      ...(horizonPeriods === undefined ? {} : { horizonPeriods }),
    },
  };
}

export interface ForecastOverrideBody {
  readonly metric: AnalyticsMetric;
  readonly grain: SupportedForecastGrain;
  readonly period: string;
  readonly snapshotId?: string;
  readonly reason: string;
  readonly locationId?: string;
  readonly channelId?: string;
}

export type ParsedForecastOverrideBody =
  { readonly ok: true; readonly fields: ForecastOverrideBody } | { readonly ok: false };

/**
 * Parses the append-override body: required `metric`, `period` (a `YYYY-MM-DD`
 * day bucket) and `reason` (the mandatory, non-empty justification); optional
 * `grain` (defaults to `day_location`), `snapshotId` and `locationId`/`channelId`
 * scope. The reason is required here and again in the command — an unexplained
 * override is refused, never stored.
 */
export function parseForecastOverrideBody(
  body: Record<string, unknown> | undefined,
): ParsedForecastOverrideBody {
  const metric = readBodyVocab(body, "metric", ANALYTICS_METRICS);
  if (metric === undefined || metric === "invalid") {
    return { ok: false };
  }
  const grain = readBodyVocab(body, "grain", SUPPORTED_FORECAST_GRAINS);
  if (grain === "invalid") {
    return { ok: false };
  }
  const period = readBodyString(body, "period");
  if (period === undefined || period === "invalid" || !DAY_PERIOD.test(period)) {
    return { ok: false };
  }
  const reason = readBodyString(body, "reason", 500);
  if (reason === undefined || reason === "invalid") {
    return { ok: false };
  }
  const snapshotId = readOptionalBodyUuid(body, "snapshotId");
  const locationId = readOptionalBodyUuid(body, "locationId");
  const channelId = readOptionalBodyUuid(body, "channelId");
  if (snapshotId === "invalid" || locationId === "invalid" || channelId === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    fields: {
      metric: metric as AnalyticsMetric,
      grain: (grain ?? DEFAULT_FORECAST_GRAIN) as SupportedForecastGrain,
      period,
      reason,
      ...(snapshotId === undefined ? {} : { snapshotId }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(channelId === undefined ? {} : { channelId }),
    },
  };
}
