import { DomainError, isSalesReportGrain } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import type { ReportingStore } from "../reporting";

import { difference, directionFor, relativeChange } from "./math";
import { periodWindows, readMetricSeries } from "./series";
import {
  ANALYTICS_FLAT_BAND_FRACTION,
  ANALYTICS_MAX_PERIODS,
  ANALYTICS_METRIC_SPECS,
  ANALYTICS_RATIO_SCALE,
  DEFAULT_TREND_PERIODS,
  isAnalyticsMetric,
  type AnalyticsScope,
  type ComputeTrendsInput,
  type TrendPoint,
  type TrendSeries,
} from "./types";

/**
 * Period-over-period trends (`W6`): each period's value with its comparison
 * against the previous period, the absolute and relative change and a direction
 * (`up`/`down`/`flat`).
 *
 * **Method** (stated on every result): the value of each period comes from the
 * existing reporting reads; the comparison is `value − previousValue` (at the
 * metric's scale) and `(value − previousValue) / previousValue` (a fraction at
 * 6 dp). A direction is `flat` when the relative change is within the stated
 * flat band (±5% by default) and otherwise its sign; when the previous value is
 * zero the relative change is undefined and the absolute change's sign decides.
 * The first period has no previous period, so its comparison is `null`.
 *
 * Decimal only (`DEC-024`); a period whose metric is undefined carries `null`
 * rather than a fabricated zero, and so does its comparison.
 */

/** The stated trend method, carried on every result. */
export const TREND_METHOD =
  "period-over-period: each period's value is read from the existing reporting reads, compared with the previous period as value − previous and (value − previous) / previous; a direction is flat when the relative change is within the stated flat band and otherwise its sign; the first period has no comparison";

/** The caveat: the first period has no previous period to compare against. */
export const TREND_FIRST_PERIOD_NOTE =
  "the first period has no previous period, so its change and direction are null";

/** The caveat: an undefined period value (yield/waste/aov) has no comparison. */
export const TREND_UNDEFINED_NOTE =
  "a period whose metric is undefined (a yield with no planned output, waste with no valued event, or an average order value with no transaction) carries null, and so does its comparison";

/**
 * Computes the trend series. `organizationId`, `metric` and `grain` are
 * required; `periods` defaults to 6 and is capped at `ANALYTICS_MAX_PERIODS`;
 * `now`, when given, must be an ISO instant. Anything else is a `DomainError`
 * before the store is touched.
 */
export async function computeTrends(
  store: ReportingStore,
  input: ComputeTrendsInput,
): Promise<TrendSeries> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (!isAnalyticsMetric(input.metric)) {
    throw new DomainError(`unknown analytics metric "${String(input.metric)}"`);
  }
  if (!isSalesReportGrain(input.grain)) {
    throw new DomainError(`unknown sales report grain "${String(input.grain)}"`);
  }
  const periods =
    input.periods === undefined || !Number.isInteger(input.periods) || input.periods < 1
      ? DEFAULT_TREND_PERIODS
      : input.periods;
  if (periods > ANALYTICS_MAX_PERIODS) {
    throw new DomainError(`periods must be at most ${ANALYTICS_MAX_PERIODS}`);
  }
  if (input.now !== undefined) {
    assertIsoInstant(input.now, "now");
  }

  const spec = ANALYTICS_METRIC_SPECS[input.metric];
  const locationIds =
    input.locationIds === undefined || input.locationIds.length === 0
      ? null
      : [...input.locationIds];
  const scope: AnalyticsScope = { locationIds, channelId: input.channelId ?? null };
  const now = input.now ?? new Date().toISOString();

  const windows = periodWindows(input.grain, now, periods);
  const series = await readMetricSeries(store, {
    organizationId: input.organizationId,
    metric: input.metric,
    grain: input.grain,
    windows,
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
  });

  const points: TrendPoint[] = series.map((entry, index) => {
    const previous = index > 0 ? series[index - 1]! : null;
    const previousValue = previous?.value ?? null;
    if (entry.value === null || previousValue === null) {
      return {
        period: entry.period,
        from: entry.from,
        to: entry.to,
        value: entry.value,
        previousValue,
        absoluteChange: null,
        relativeChange: null,
        direction: null,
      };
    }
    const absoluteChange = difference(entry.value, previousValue, spec.scale);
    const relative = relativeChange(entry.value, previousValue, spec.scale, ANALYTICS_RATIO_SCALE);
    return {
      period: entry.period,
      from: entry.from,
      to: entry.to,
      value: entry.value,
      previousValue,
      absoluteChange,
      relativeChange: relative,
      direction: directionFor(
        absoluteChange,
        relative,
        spec.scale,
        ANALYTICS_FLAT_BAND_FRACTION,
        ANALYTICS_RATIO_SCALE,
      ),
    };
  });

  return {
    asOf: new Date().toISOString(),
    metric: input.metric,
    metricLabel: spec.label,
    unit: spec.unit,
    grain: input.grain,
    scope,
    method: TREND_METHOD,
    flatBandFraction: ANALYTICS_FLAT_BAND_FRACTION,
    points,
    notes: [spec.definition, TREND_FIRST_PERIOD_NOTE, TREND_UNDEFINED_NOTE],
  };
}
