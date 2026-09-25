import type { ForecastGrain, ForecastTrackingStatus } from "@aquarela/application";

import { formatFractionPct } from "./analytics-labels";

/**
 * Presentation helpers for the forecast-tracking section (`DEC-011`,
 * `DEC-138`). Kept free of Next/DB imports so they can be unit tested directly.
 * Decimal fractions stay decimal through formatting (`DEC-024`): a MAPE or a
 * percentage error is rendered by the shared exact-BigInt percentage formatter,
 * never a float.
 */

/** The grain labels (`DEC-011`); only `day_location` is implemented today. */
export const GRAIN_LABELS: Record<ForecastGrain, string> = {
  day_location: "Daily, by location",
  day_location_category: "Daily, by location & category",
  day_location_product: "Daily, by location & product",
};

/** `day_location` → "Daily, by location", … (an unknown grain reads as itself). */
export function grainLabel(grain: string): string {
  return GRAIN_LABELS[grain as ForecastGrain] ?? grain;
}

/** The honest tracking states, as display copy. */
export const TRACKING_STATUS_LABELS: Record<ForecastTrackingStatus, string> = {
  ok: "Tracking",
  insufficient_history: "Not enough completed periods",
  no_snapshot: "No snapshot recorded",
};

/** `ok` → "Tracking", … */
export function trackingStatusLabel(status: ForecastTrackingStatus): string {
  return TRACKING_STATUS_LABELS[status];
}

/** The `StatusPill` tone for each tracking state. */
export function trackingStatusTone(
  status: ForecastTrackingStatus,
): "success" | "warning" | "neutral" {
  switch (status) {
    case "ok":
      return "success";
    case "insufficient_history":
      return "warning";
    default:
      return "neutral";
  }
}

/**
 * The out-of-sample MAPE (a fraction at 6 dp) as a percentage, or "n/a" when the
 * backend withheld it — never a fabricated figure. Lower is better.
 */
export function formatAccuracy(mape: string | null): string {
  return mape === null ? "n/a" : formatFractionPct(mape);
}

/** A period's percentage error (a fraction at 6 dp) as a percentage, or "n/a". */
export function formatTrackingError(fraction: string | null): string {
  return fraction === null ? "n/a" : formatFractionPct(fraction);
}

/** The completed-periods summary, singular/plural correct. */
export function formatCompletedPeriods(count: number): string {
  return `${count} completed ${count === 1 ? "period" : "periods"}`;
}
