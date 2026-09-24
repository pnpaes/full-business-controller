import {
  ANALYTICS_METRICS,
  ANALYTICS_METRIC_SPECS,
  BENCHMARK_DIMENSIONS,
  type AnalyticsMetric,
  type BenchmarkDimension,
  type MetricUnit,
  type SuggestionSeverity,
  type TrendDirection,
} from "@aquarela/application";
import { TAX_RATE_SCALE, divideRoundHalfUp, formatDecimal, parseDecimal } from "@aquarela/domain";

import { formatMoney, formatPct, formatQuantity } from "./reports/report-labels";

/**
 * Presentation helpers for the analytics screens (`W6`). Kept free of Next/DB
 * imports so they can be unit tested directly. Decimal strings stay decimal
 * through formatting (`DEC-024`): a fraction becomes a percentage with exact
 * BigInt arithmetic, never a float.
 */

/** The metric options in selector order. */
export const METRIC_OPTIONS: readonly AnalyticsMetric[] = ANALYTICS_METRICS;

/** `revenue` → "Net sales", … from the shared metric specs. */
export function metricLabel(metric: AnalyticsMetric): string {
  return ANALYTICS_METRIC_SPECS[metric].label;
}

/** True when `value` is a known analytics metric. */
export function isMetric(value: string): value is AnalyticsMetric {
  return (ANALYTICS_METRICS as readonly string[]).includes(value);
}

/** The benchmark dimension options in selector order. */
export const DIMENSION_OPTIONS: readonly BenchmarkDimension[] = BENCHMARK_DIMENSIONS;

/** `location` → "Location", … */
export const DIMENSION_LABELS: Record<BenchmarkDimension, string> = {
  location: "Location",
  product: "Product",
  channel: "Channel",
};

/** True when `value` is a known benchmark dimension. */
export function isDimension(value: string): value is BenchmarkDimension {
  return (BENCHMARK_DIMENSIONS as readonly string[]).includes(value);
}

/** The direction labels and glyphs (a glyph is always paired with a word). */
export const DIRECTION_LABELS: Record<TrendDirection, string> = {
  up: "Up",
  down: "Down",
  flat: "Flat",
};

export const DIRECTION_GLYPHS: Record<TrendDirection, string> = {
  up: "↗",
  down: "↘",
  flat: "→",
};

/** The severity labels and their `StatusPill` tone. */
export const SEVERITY_LABELS: Record<SuggestionSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function severityTone(
  severity: SuggestionSeverity,
): "info" | "success" | "warning" | "danger" {
  switch (severity) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "info";
  }
}

/** A fraction at 6 dp → a 1 dp percentage string ("0.200000" → "20.0%"). */
export function formatFractionPct(fraction: string): string {
  const percentTenths = divideRoundHalfUp(parseDecimal(fraction, TAX_RATE_SCALE), 1000n);
  return `${formatDecimal(percentTenths, 1)}%`;
}

/** A relative change (or null) → "20.0%" or "n/a". */
export function formatRelativeChange(fraction: string | null): string {
  return fraction === null ? "n/a" : formatFractionPct(fraction);
}

/** The flat band (a 6 dp fraction) → "±5.0%". */
export function formatFlatBand(fraction: string): string {
  const percentTenths = divideRoundHalfUp(parseDecimal(fraction, TAX_RATE_SCALE), 1000n);
  return `±${formatDecimal(percentTenths, 1)}%`;
}

/** A direction (or null) → "Up", "Down", "Flat" or "n/a". */
export function formatDirection(direction: TrendDirection | null): string {
  return direction === null ? "n/a" : DIRECTION_LABELS[direction];
}

/**
 * A metric value in its unit: money at 2 dp with NOK, a quantity at 3 dp, a
 * count verbatim, a ratio as a percentage. `null` renders "n/a" (an undefined
 * period is never shown as zero).
 */
export function formatMetricValue(value: string | null, unit: MetricUnit): string {
  if (value === null) {
    return "n/a";
  }
  switch (unit) {
    case "money":
      return `${formatMoney(value)} NOK`;
    case "quantity":
      return formatQuantity(value);
    case "ratio":
      return formatFractionPct(value);
    default:
      return value;
  }
}

/** A contribution-margin percentage (6 dp percent, e.g. "12.500000") or "n/a". */
export function formatMarginPct(value: string | null): string {
  return formatPct(value);
}

/** The exact ratio (6 dp fraction) as a percentage, or "n/a". */
export function formatRatio(value: string | null): string {
  return value === null ? "n/a" : formatFractionPct(value);
}

/** A `numeric(19,4)` money string → 2 dp with NOK, or "n/a". */
export function formatMoneyOrNa(value: string | null): string {
  return value === null ? "n/a" : `${formatMoney(value)} NOK`;
}

/** The `1 − ratio` shortfall as a percentage, or "n/a". */
export function formatShortfall(ratio: string | null): string {
  if (ratio === null) {
    return "n/a";
  }
  const one = 10n ** BigInt(TAX_RATE_SCALE);
  const shortfall = one - parseDecimal(ratio, TAX_RATE_SCALE);
  return formatFractionPct(formatDecimal(shortfall, TAX_RATE_SCALE));
}
