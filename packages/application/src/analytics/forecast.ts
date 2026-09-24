import { DomainError, isSalesReportGrain } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import type { ReportingStore } from "../reporting";

import { formatModelValue, linearFit, meanAbsolutePercentageError, toNumber } from "./math";
import { futurePeriods, periodWindows, readMetricSeries } from "./series";
import {
  ANALYTICS_MAX_PERIODS,
  ANALYTICS_METRIC_SPECS,
  ANALYTICS_RATIO_SCALE,
  DEFAULT_FORECAST_HISTORY_PERIODS,
  DEFAULT_FORECAST_HORIZON_PERIODS,
  FORECAST_MINIMUM_HISTORY_POINTS,
  isAnalyticsMetric,
  type AnalyticsScope,
  type ComputeForecastInput,
  type ForecastAccuracy,
  type ForecastHistoryPoint,
  type ForecastProjectionPoint,
  type ForecastResult,
} from "./types";

/**
 * A simple, honest forecast (`W6`).
 *
 * **Method (chosen and stated):** an ordinary **least-squares linear trend**
 * `y = intercept + slope·x` fitted over the history at x = 0..n−1 (the moving
 * average was the alternative; the linear trend states its direction and is the
 * smaller arithmetic). The projection is that line extended over the horizon.
 * The band is **±1 residual standard deviation** `√(Σr² / (n − 2))` from the
 * fitted history, so it widens with a noisier history. Accuracy is backtested
 * over the same history as the **mean absolute percentage error**.
 *
 * **It is advisory.** The result is labelled a model with its method, inputs
 * and error; it is never presented as a fact. If the history is shorter than
 * three periods, or a period has no computable value, the result is an explicit
 * `insufficient_history` with the reason — never a projection from too little
 * history. The model arithmetic is floating-point internally; every returned
 * figure is rounded to the metric's storage scale and carried as a decimal
 * string.
 */

/** The stated forecast method, carried on every result. */
export const FORECAST_METHOD =
  "least-squares linear trend fitted over the history (y = intercept + slope·x, x = 0..n−1), projected over the horizon; the band is ±1 residual standard deviation √(Σr²/(n−2))";

/** The caveat: the result is a model, never a fact. */
export const FORECAST_ADVISORY_NOTE =
  "this is a model, not a recorded fact: the projection is the fitted trend extended, and the band is its historical error — treat it as advisory only";

/** The caveat: the band is a literal residual-σ interval, not clamped. */
export const FORECAST_BAND_NOTE =
  "the band is a literal ±1 residual-σ interval of the model and is not clamped to zero";

/** The caveat: the accuracy is an in-sample backtest, not out-of-sample. */
export const FORECAST_ACCURACY_NOTE =
  "accuracy is an in-sample backtest (MAPE over the fitted history), not an out-of-sample test";

/**
 * Computes the forecast. `organizationId`, `metric` and `grain` are required;
 * `historyPeriods` defaults to 12 and `horizonPeriods` to 3, each capped at
 * `ANALYTICS_MAX_PERIODS`; `now`, when given, must be an ISO instant. Anything
 * else is a `DomainError` before the store is touched.
 */
export async function computeForecast(
  store: ReportingStore,
  input: ComputeForecastInput,
): Promise<ForecastResult> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (!isAnalyticsMetric(input.metric)) {
    throw new DomainError(`unknown analytics metric "${String(input.metric)}"`);
  }
  if (!isSalesReportGrain(input.grain)) {
    throw new DomainError(`unknown sales report grain "${String(input.grain)}"`);
  }
  const historyPeriods =
    input.historyPeriods === undefined ||
    !Number.isInteger(input.historyPeriods) ||
    input.historyPeriods < 1
      ? DEFAULT_FORECAST_HISTORY_PERIODS
      : input.historyPeriods;
  const horizonPeriods =
    input.horizonPeriods === undefined ||
    !Number.isInteger(input.horizonPeriods) ||
    input.horizonPeriods < 1
      ? DEFAULT_FORECAST_HORIZON_PERIODS
      : input.horizonPeriods;
  if (historyPeriods > ANALYTICS_MAX_PERIODS || horizonPeriods > ANALYTICS_MAX_PERIODS) {
    throw new DomainError(
      `historyPeriods and horizonPeriods must be at most ${ANALYTICS_MAX_PERIODS}`,
    );
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

  const windows = periodWindows(input.grain, now, historyPeriods);
  const series = await readMetricSeries(store, {
    organizationId: input.organizationId,
    metric: input.metric,
    grain: input.grain,
    windows,
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
  });

  const base = {
    asOf: new Date().toISOString(),
    metric: input.metric,
    metricLabel: spec.label,
    unit: spec.unit,
    grain: input.grain,
    scope,
    method: FORECAST_METHOD,
  } as const;

  const missing = series.find((entry) => entry.value === null);
  if (series.length < FORECAST_MINIMUM_HISTORY_POINTS) {
    return {
      ...base,
      status: "insufficient_history",
      history: [],
      projection: [],
      model: null,
      accuracy: null,
      insufficient: {
        status: "insufficient_history",
        reason: `history has ${series.length} ${series.length === 1 ? "period" : "periods"}; a least-squares fit needs at least ${FORECAST_MINIMUM_HISTORY_POINTS}`,
        historyPoints: series.length,
        minimumPoints: FORECAST_MINIMUM_HISTORY_POINTS,
      },
      notes: [spec.definition, FORECAST_ADVISORY_NOTE],
    };
  }
  if (missing !== undefined) {
    return {
      ...base,
      status: "insufficient_history",
      history: [],
      projection: [],
      model: null,
      accuracy: null,
      insufficient: {
        status: "insufficient_history",
        reason: `history contains a period with no computable value (${missing.period}); the fit needs a value in every period`,
        historyPoints: series.length,
        minimumPoints: FORECAST_MINIMUM_HISTORY_POINTS,
      },
      notes: [spec.definition, FORECAST_ADVISORY_NOTE],
    };
  }

  const actual = series.map((entry) => toNumber(entry.value!));
  const fit = linearFit(actual);
  const residualStdDev = fit.residualStdDev ?? 0;

  const history: ForecastHistoryPoint[] = series.map((entry, index) => ({
    period: entry.period,
    // The actual figure stays the exact stored decimal string; the fitted value
    // is the model's, rounded to the metric's scale.
    value: entry.value!,
    fitted: formatModelValue(fit.fitted[index]!, spec.scale),
  }));

  const lastWindow = windows[windows.length - 1]!;
  const projection: ForecastProjectionPoint[] = futurePeriods(
    input.grain,
    lastWindow,
    horizonPeriods,
  ).map((window, index) => {
    const x = series.length - 1 + (index + 1);
    const value = fit.intercept + fit.slope * x;
    return {
      period: window.period,
      value: formatModelValue(value, spec.scale),
      lower: formatModelValue(value - residualStdDev, spec.scale),
      upper: formatModelValue(value + residualStdDev, spec.scale),
    };
  });

  const mape = meanAbsolutePercentageError(actual, fit.fitted);
  const nonZero = actual.filter((value) => value !== 0).length;
  const accuracy: ForecastAccuracy = {
    method: "mape",
    methodNote:
      "mean absolute percentage error over the fitted history, at the points with a non-zero actual",
    mape: mape === null ? null : formatModelValue(mape, ANALYTICS_RATIO_SCALE),
    points: nonZero,
  };

  return {
    ...base,
    status: "ok",
    history,
    projection,
    model: {
      method: "least_squares_linear",
      methodNote: FORECAST_METHOD,
      slopePerPeriod: formatModelValue(fit.slope, spec.scale),
      intercept: formatModelValue(fit.intercept, spec.scale),
      confidence: {
        method: "±1 residual standard deviation over the fitted history (n − 2 degrees of freedom)",
        bandScale: formatModelValue(residualStdDev, spec.scale),
      },
    },
    accuracy,
    insufficient: null,
    notes: [spec.definition, FORECAST_ADVISORY_NOTE, FORECAST_BAND_NOTE, FORECAST_ACCURACY_NOTE],
  };
}
