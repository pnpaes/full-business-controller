import { DomainError } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import type { ReportingStore } from "../reporting";

import { normalizeForecastScope, requireSupportedForecastGrain } from "./forecast-scope";
import { difference, formatModelValue, meanAbsolutePercentageError, ratio, toNumber } from "./math";
import { readMetricSeries, type PeriodWindow } from "./series";
import {
  ANALYTICS_METRIC_SPECS,
  ANALYTICS_RATIO_SCALE,
  FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS,
  isAnalyticsMetric,
  type ComputeForecastTrackingInput,
  type ForecastOverrideSummary,
  type ForecastTrackingAccuracy,
  type ForecastTrackingPeriod,
  type ForecastTrackingReport,
} from "./types";
import type { ForecastReadStore } from "./read-types";

/**
 * Forecast-vs-actual tracking (`DEC-011`, row 15): for each **completed** period
 * a recorded snapshot projected, the actual value read from the existing
 * reporting reads, the absolute and percentage error, and a MAPE accuracy over
 * the completed periods.
 *
 * **Honesty is the contract.** The accuracy is **out-of-sample** (unlike the
 * snapshot's in-sample backtest), it is withheld below
 * `FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS` completed periods
 * (`insufficient_history`) and when the scope has never had a snapshot
 * (`no_snapshot`) — never a number from too few points. Only completed periods
 * are compared (a period still in progress would be a fabricated actual), and a
 * period whose metric is undefined carries `null`, not a zero.
 *
 * `DEC-011`'s category/product grains are not implemented: the reporting read
 * behind the actuals cannot scope by category or product, so tracking refuses
 * any grain but `day_location` rather than compare against the wrong scope.
 */

/** The stated tracking method, carried on every result. */
export const FORECAST_TRACKING_METHOD =
  "forecast-vs-actual over each completed projected period: the error is |actual − projected|, and the accuracy is the mean absolute percentage error over the completed periods with a non-zero actual (out-of-sample, unlike the snapshot's in-sample backtest)";

/** The caveat: the accuracy is withheld below the minimum completed periods. */
export const FORECAST_TRACKING_MINIMUM_NOTE =
  "accuracy is withheld (insufficient_history) below the stated minimum completed periods; a mean over fewer points is never reported";

/** The caveat: there is no snapshot to track. */
export const FORECAST_TRACKING_NO_SNAPSHOT_NOTE =
  "no snapshot has been recorded for this scope, so there is nothing to track";

/** The caveat: overrides are advisory. */
export const FORECAST_TRACKING_OVERRIDE_NOTE =
  "recorded overrides are advisory human annotations and are never auto-applied";

/** The `YYYY-MM-DD` day-bucket shape shared by the tracking read and the override command. */
export const DAY_PERIOD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC day window of a stored projection period (`YYYY-MM-DD`). Every
 * forecast grain buckets by day, so a projection period is always a day bucket;
 * anything else is a `DomainError` (a malformed stored row is loud, not silent).
 */
function dayWindow(period: string): PeriodWindow {
  if (!DAY_PERIOD.test(period)) {
    throw new DomainError(
      `forecast projection period "${period}" is not a day bucket (YYYY-MM-DD)`,
    );
  }
  const start = new Date(`${period}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new DomainError(`forecast projection period "${period}" is not a valid day`);
  }
  return {
    period,
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000 - 1).toISOString(),
  };
}

/** The absolute value of a decimal string at a fixed scale. */
function absoluteOf(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

/**
 * Tracks the newest snapshot for one organization/scope. `organizationId`,
 * `metric` and `grain` are required; `now`, when given, must be an ISO instant;
 * anything else is a `DomainError` before the store is touched.
 */
export async function computeForecastTracking(
  store: ForecastReadStore & ReportingStore,
  input: ComputeForecastTrackingInput,
): Promise<ForecastTrackingReport> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (!isAnalyticsMetric(input.metric)) {
    throw new DomainError(`unknown analytics metric "${String(input.metric)}"`);
  }
  const grain = requireSupportedForecastGrain(input.grain);
  if (input.now !== undefined) {
    assertIsoInstant(input.now, "now");
  }

  const spec = ANALYTICS_METRIC_SPECS[input.metric];
  const scope = normalizeForecastScope({
    locationId: input.locationId,
    channelId: input.channelId,
  });
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);

  const lookup = {
    organizationId: input.organizationId,
    metric: input.metric,
    grain,
    locationId: scope.locationId,
    channelId: scope.channelId,
    category: scope.category,
    productVariantId: scope.productVariantId,
  } as const;

  const snapshot = await store.findLatestForecastSnapshot(lookup);
  const overrides = await store.listForecastOverrides(lookup);
  const overrideSummaries: ForecastOverrideSummary[] = overrides.map((override) => ({
    id: override.id,
    snapshotId: override.snapshotId,
    period: override.period,
    actorId: override.actorId,
    reason: override.reason,
    recordedAt: override.createdAt,
  }));

  const base = {
    asOf: new Date().toISOString(),
    metric: input.metric,
    metricLabel: spec.label,
    unit: spec.unit,
    grain,
    scope,
    minimumCompletedPeriods: FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS,
    overrides: overrideSummaries,
    notes: [spec.definition, FORECAST_TRACKING_METHOD, FORECAST_TRACKING_OVERRIDE_NOTE],
  } as const;

  if (snapshot === undefined) {
    return {
      ...base,
      status: "no_snapshot",
      snapshotId: null,
      snapshotAsOf: null,
      snapshotGeneratedAt: null,
      model: null,
      completedPeriods: 0,
      periods: [],
      accuracy: null,
      reason: FORECAST_TRACKING_NO_SNAPSHOT_NOTE,
      notes: [...base.notes, FORECAST_TRACKING_NO_SNAPSHOT_NOTE],
    };
  }

  const completedWindows: PeriodWindow[] = [];
  const seen = new Set<string>();
  for (const point of snapshot.projection) {
    if (seen.has(point.period)) {
      continue;
    }
    const window = dayWindow(point.period);
    if (Date.parse(window.to) < nowMs) {
      seen.add(point.period);
      completedWindows.push(window);
    }
  }

  const locationFilter =
    scope.locationId === null ? {} : { locationIds: [scope.locationId] as const };
  const channelFilter = scope.channelId === null ? {} : { channelId: scope.channelId };
  const series = await readMetricSeries(store, {
    organizationId: input.organizationId,
    metric: input.metric,
    grain: "day",
    windows: completedWindows,
    ...locationFilter,
    ...channelFilter,
  });

  const projectedByPeriod = new Map(
    snapshot.projection.map((point) => [point.period, point.value]),
  );
  const periods: ForecastTrackingPeriod[] = completedWindows.map((window, index) => {
    const projected = projectedByPeriod.get(window.period)!;
    const actual = series[index]?.value ?? null;
    if (actual === null) {
      return {
        period: window.period,
        from: window.from,
        to: window.to,
        projected,
        actual: null,
        absoluteError: null,
        percentageError: null,
      };
    }
    const absoluteError = absoluteOf(difference(actual, projected, spec.scale));
    return {
      period: window.period,
      from: window.from,
      to: window.to,
      projected,
      actual,
      absoluteError,
      percentageError: ratio(absoluteError, actual, spec.scale, ANALYTICS_RATIO_SCALE),
    };
  });

  if (periods.length < FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS) {
    const reason = `only ${periods.length} completed ${
      periods.length === 1 ? "period" : "periods"
    } since the snapshot; accuracy needs at least ${FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS}`;
    return {
      ...base,
      status: "insufficient_history",
      snapshotId: snapshot.id,
      snapshotAsOf: snapshot.asOf,
      snapshotGeneratedAt: snapshot.generatedAt,
      model: snapshot.model,
      completedPeriods: periods.length,
      periods,
      accuracy: null,
      reason,
      notes: [...base.notes, FORECAST_TRACKING_MINIMUM_NOTE],
    };
  }

  const actuals: number[] = [];
  const projecteds: number[] = [];
  for (const period of periods) {
    if (period.actual === null) {
      continue;
    }
    actuals.push(toNumber(period.actual));
    projecteds.push(toNumber(period.projected));
  }
  const mape = meanAbsolutePercentageError(actuals, projecteds);
  const accuracy: ForecastTrackingAccuracy = {
    method: "mape",
    methodNote:
      "mean absolute percentage error over the completed periods, at the points with a non-zero actual, as a fraction at 6 dp (0.05 = 5%)",
    mape: mape === null ? null : formatModelValue(mape, ANALYTICS_RATIO_SCALE),
    periods: actuals.filter((value) => value !== 0).length,
  };

  return {
    ...base,
    status: "ok",
    snapshotId: snapshot.id,
    snapshotAsOf: snapshot.asOf,
    snapshotGeneratedAt: snapshot.generatedAt,
    model: snapshot.model,
    completedPeriods: periods.length,
    periods,
    accuracy,
    reason: null,
  };
}
