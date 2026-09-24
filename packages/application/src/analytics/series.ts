import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  contributionBeforeLabour,
  divideRoundHalfUp,
  formatDecimal,
  isSalesReportGrain,
  parseDecimal,
  periodBucket,
  yieldRatio,
  type SalesReportGrain,
} from "@aquarela/domain";

import type { ReportingStore, SalesMeasures } from "../reporting";

import { type AnalyticsMetric } from "./types";

/**
 * The shared period-series reader behind trends, forecasts and suggestions.
 *
 * It answers one question — "what was this metric in each period?" — by calling
 * the **existing** reporting reads (`summarizeSales` grouped by period for the
 * sales metrics; `sumProductionYield` and `sumWasteByStage` once per period for
 * production yield and waste). No new SQL, no aggregate table. A period with no
 * rows is a genuine zero for a sales metric (nothing sold) but `null` for
 * production yield and waste (undefined, never a silent zero).
 */

/** One period window with its grain bucket label. */
export interface PeriodWindow {
  readonly period: string;
  readonly from: string;
  readonly to: string;
}

/** One period's metric value. */
export interface MetricPeriodValue {
  readonly period: string;
  readonly from: string;
  readonly to: string;
  readonly value: string | null;
}

/** The sales-derived metrics (answered by one `summarizeSales` period read). */
const SALES_METRICS: ReadonlySet<AnalyticsMetric> = new Set([
  "revenue",
  "contribution",
  "units",
  "transactions",
  "average_order_value",
]);

/** True when the metric is answered by the sales group-by. */
export function isSalesMetric(metric: AnalyticsMetric): boolean {
  return SALES_METRICS.has(metric);
}

/** The UTC start of the grain period containing `date`. */
function periodStart(grain: SalesReportGrain, date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (grain === "day") {
    return new Date(Date.UTC(year, month, day));
  }
  if (grain === "week") {
    const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    return new Date(Date.UTC(year, month, day - (isoWeekday - 1)));
  }
  return new Date(Date.UTC(year, month, 1));
}

/** The UTC start of the period after the one starting at `start`. */
function nextPeriodStart(grain: SalesReportGrain, start: Date): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  if (grain === "day") {
    return new Date(Date.UTC(year, month, day + 1));
  }
  if (grain === "week") {
    return new Date(Date.UTC(year, month, day + 7));
  }
  return new Date(Date.UTC(year, month + 1, 1));
}

/** The last instant of the period starting at `start` (23:59:59.999 on the last day). */
function periodEnd(grain: SalesReportGrain, start: Date): Date {
  return new Date(nextPeriodStart(grain, start).getTime() - 1);
}

/** One grain window from its start instant, capped at `now` for the current period. */
function windowFrom(
  grain: SalesReportGrain,
  start: Date,
  now: Date,
  isCurrent: boolean,
): PeriodWindow {
  const from = start.toISOString();
  const to = (isCurrent ? now : periodEnd(grain, start)).toISOString();
  return { period: periodBucket(grain, from), from, to };
}

/**
 * The `count` grain windows ending with the period containing `now`, oldest
 * first. The current period's upper bound is `now`, so a dashboard never shows
 * a future period; every earlier period is a complete window.
 */
export function periodWindows(
  grain: SalesReportGrain,
  nowIso: string,
  count: number,
): readonly PeriodWindow[] {
  if (!isSalesReportGrain(grain)) {
    throw new DomainError(`unknown sales report grain "${String(grain)}"`);
  }
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    throw new DomainError(`"${nowIso}" is not a valid ISO-8601 instant`);
  }
  const starts: Date[] = [];
  let start = periodStart(grain, now);
  for (let index = 0; index < count; index += 1) {
    starts.unshift(start);
    start = periodStart(grain, new Date(start.getTime() - 1));
  }
  return starts.map((value, index) => windowFrom(grain, value, now, index === count - 1));
}

/** The `count` grain windows after `after`, oldest first (for a projection). */
export function futurePeriods(
  grain: SalesReportGrain,
  after: PeriodWindow,
  count: number,
): readonly PeriodWindow[] {
  const windows: PeriodWindow[] = [];
  let start = nextPeriodStart(grain, new Date(after.from));
  for (let index = 0; index < count; index += 1) {
    windows.push({
      period: periodBucket(grain, start.toISOString()),
      from: start.toISOString(),
      to: periodEnd(grain, start).toISOString(),
    });
    start = nextPeriodStart(grain, start);
  }
  return windows;
}

/**
 * The metric value of one grouped sales row. `null` for the average order value
 * when the group has no transaction (undefined, never a fabricated zero) and
 * for production yield / waste, which are not answered by this read.
 */
export function salesMetricValue(metric: AnalyticsMetric, row: SalesMeasures): string | null {
  switch (metric) {
    case "revenue":
      return row.netSales;
    case "contribution":
      return contributionBeforeLabour(row.netSales, row.ingredientCost);
    case "units":
      return row.units;
    case "transactions":
      return String(row.transactions);
    case "average_order_value": {
      if (row.transactions <= 0) {
        return null;
      }
      return formatDecimal(
        divideRoundHalfUp(parseDecimal(row.netSales, MONEY_SCALE), BigInt(row.transactions)),
        MONEY_SCALE,
      );
    }
    default:
      return null;
  }
}

/** Sums quantity strings at `QUANTITY_SCALE`. */
function sumQuantity(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += parseDecimal(value, QUANTITY_SCALE);
  }
  return formatDecimal(total, QUANTITY_SCALE);
}

/** Sums the non-null money strings at `MONEY_SCALE`; `null` when none carries a value. */
function sumNullableMoney(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0) {
    return null;
  }
  let total = 0n;
  for (const value of present) {
    total += parseDecimal(value, MONEY_SCALE);
  }
  return formatDecimal(total, MONEY_SCALE);
}

/** The production yield over one window: actual ÷ planned, `null` when planned ≤ 0. */
async function productionYieldFor(
  store: ReportingStore,
  organizationId: string,
  window: PeriodWindow,
  locationIds: readonly string[] | undefined,
): Promise<string | null> {
  const rows = await store.sumProductionYield({
    organizationId,
    from: window.from,
    to: window.to,
    ...(locationIds === undefined ? {} : { locationIds }),
  });
  const planned = sumQuantity(rows.map((row) => row.plannedOutput));
  const actual = sumQuantity(rows.map((row) => row.actualOutput));
  return yieldRatio(planned, actual);
}

/** The moving-average waste value over one window; `null` when no valued event. */
async function wasteFor(
  store: ReportingStore,
  organizationId: string,
  window: PeriodWindow,
  locationIds: readonly string[] | undefined,
): Promise<string | null> {
  const rows = await store.sumWasteByStage({
    organizationId,
    from: window.from,
    to: window.to,
    ...(locationIds === undefined ? {} : { locationIds }),
  });
  return sumNullableMoney(rows.map((row) => row.value));
}

export interface ReadMetricSeriesInput {
  readonly organizationId: string;
  readonly metric: AnalyticsMetric;
  readonly grain: SalesReportGrain;
  readonly windows: readonly PeriodWindow[];
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string | undefined;
}

/**
 * The metric's value in each window. The sales metrics share **one**
 * `summarizeSales` period read over the whole span (missing buckets are genuine
 * zeros); production yield and waste are read once per period (the existing
 * reads are not period-grouped). The reads are sequential, not concurrent: they
 * may share one transaction client.
 */
export async function readMetricSeries(
  store: ReportingStore,
  input: ReadMetricSeriesInput,
): Promise<readonly MetricPeriodValue[]> {
  const { windows } = input;
  if (windows.length === 0) {
    return [];
  }
  const locationFilter = input.locationIds === undefined ? {} : { locationIds: input.locationIds };
  if (isSalesMetric(input.metric)) {
    const first = windows[0]!;
    const last = windows[windows.length - 1]!;
    const summary = await store.summarizeSales({
      organizationId: input.organizationId,
      from: first.from,
      to: last.to,
      grain: input.grain,
      groupBy: "period",
      ...locationFilter,
      ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    });
    const byBucket = new Map(summary.rows.map((row) => [row.periodBucket, row]));
    return windows.map((window) => {
      const row = byBucket.get(window.period);
      return {
        period: window.period,
        from: window.from,
        to: window.to,
        // A missing bucket is a real zero for a sum, but the average order value
        // stays undefined (null) with no transaction — never a fabricated zero.
        value:
          row === undefined
            ? missingPeriodValue(input.metric)
            : salesMetricValue(input.metric, row),
      };
    });
  }
  const values: MetricPeriodValue[] = [];
  for (const window of windows) {
    const value =
      input.metric === "production_yield"
        ? await productionYieldFor(store, input.organizationId, window, input.locationIds)
        : await wasteFor(store, input.organizationId, window, input.locationIds);
    values.push({ period: window.period, from: window.from, to: window.to, value });
  }
  return values;
}

/** The value for a sales metric with no rows in a period: a real zero, or null. */
function missingPeriodValue(metric: AnalyticsMetric): string | null {
  if (metric === "average_order_value") {
    // No transaction: the average order value is undefined, not zero.
    return null;
  }
  if (metric === "transactions") {
    return "0";
  }
  if (metric === "units") {
    return formatDecimal(0n, QUANTITY_SCALE);
  }
  return formatDecimal(0n, MONEY_SCALE);
}
