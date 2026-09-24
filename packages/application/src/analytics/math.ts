import { DomainError, divideRoundHalfUp, formatDecimal, parseDecimal } from "@aquarela/domain";

/**
 * The small arithmetic the analytics reads need, written here rather than added
 * as a dependency (`W6`: no new dependency).
 *
 * Two kinds of maths live side by side:
 * - **Exact decimal maths** for every reported figure (`difference`, `ratio`,
 *   `directionFor`, `clampScale`): `bigint` scaled integers, HALF_UP at the
 *   named scale (`DEC-024`), never a float. Money and quantities stay decimal.
 * - **Model maths** for the least-squares fit (`linearFit`, `meanAbsolute…`):
 *   floating point internally, because ordinary least squares needs division
 *   and a square root. Nothing floating-point ever leaves this module as a
 *   reported value: `formatModelValue` rounds the model output to the metric's
 *   storage scale and returns a decimal string, and the result is labelled a
 *   model, never a fact.
 */

/** `a − b` at `scale` (HALF_UP never applies to an exact subtraction). */
export function difference(a: string, b: string, scale: number): string {
  return formatDecimal(parseDecimal(a, scale) - parseDecimal(b, scale), scale);
}

/**
 * `a / b` as a fraction at `toScale`, or `null` when `b` is zero (undefined,
 * never a fabricated zero). HALF_UP (`DEC-024`). Both inputs are read at
 * `fromScale`; a malformed decimal is a `DomainError`.
 */
export function ratio(a: string, b: string, fromScale: number, toScale: number): string | null {
  const numerator = parseDecimal(a, fromScale);
  const denominator = parseDecimal(b, fromScale);
  if (denominator === 0n) {
    return null;
  }
  // Both inputs are at `fromScale`, so their scales cancel: the result at
  // `toScale` is `(a · 10^toScale) / b`.
  return formatDecimal(divideRoundHalfUp(numerator * 10n ** BigInt(toScale), denominator), toScale);
}

/**
 * `(current − previous) / previous` as a fraction at `scale`, or `null` when
 * `previous` is zero (the relative change is undefined). Exact decimal maths.
 */
export function relativeChange(
  current: string,
  previous: string,
  fromScale: number,
  scale: number,
): string | null {
  const previousValue = parseDecimal(previous, fromScale);
  if (previousValue === 0n) {
    return null;
  }
  const delta = parseDecimal(current, fromScale) - previousValue;
  // The delta and the previous value share `fromScale`, so the relative change
  // at `scale` is `(delta · 10^scale) / previous`.
  return formatDecimal(divideRoundHalfUp(delta * 10n ** BigInt(scale), previousValue), scale);
}

/**
 * The direction of a change: `flat` when a relative change exists and is within
 * the flat band, otherwise the sign of the relative change; when the relative
 * change is undefined (previous zero) the sign of the absolute change decides.
 * Both the relative change and the band are fractions at the same `scale`.
 */
export function directionFor(
  absoluteChange: string,
  relativeChangeValue: string | null,
  absoluteScale: number,
  bandFraction: string,
  scale: number,
): "up" | "down" | "flat" {
  if (relativeChangeValue !== null) {
    const relative = parseDecimal(relativeChangeValue, scale);
    const band = parseDecimal(bandFraction, scale);
    if (relative >= -band && relative <= band) {
      return "flat";
    }
    return relative > 0n ? "up" : "down";
  }
  const absolute = parseDecimal(absoluteChange, absoluteScale);
  return absolute > 0n ? "up" : absolute < 0n ? "down" : "flat";
}

/** True when `value` is strictly below `1 − threshold` (a fraction), exactly. */
export function belowFraction(value: string, threshold: string, scale: number): boolean {
  const one = parseDecimal("1", scale);
  const limit = one - parseDecimal(threshold, scale);
  return parseDecimal(value, scale) < limit;
}

/** True when `value` is strictly below `threshold` (a fraction), exactly. */
export function below(value: string, threshold: string, scale: number): boolean {
  return parseDecimal(value, scale) < parseDecimal(threshold, scale);
}

/** A finite number for the model maths, or a `DomainError` for a non-numeric input. */
export function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainError(`"${value}" is not a finite number`);
  }
  return parsed;
}

/**
 * Rounds a model value to `scale` (HALF_UP away from zero) and returns a decimal
 * string. The only place a floating-point model value becomes a reported figure.
 * A magnitude beyond `Number.MAX_SAFE_INTEGER` at the target scale is rejected
 * rather than silently rounded (the same guard the count adapter uses).
 */
export function formatModelValue(value: number, scale: number): string {
  if (!Number.isFinite(value)) {
    throw new DomainError("model value is not finite");
  }
  const negative = value < 0;
  const scaled = Math.round(Math.abs(value) * 10 ** scale);
  if (!Number.isSafeInteger(scaled)) {
    throw new DomainError("model value exceeds safe integer precision");
  }
  const magnitude = BigInt(scaled);
  return formatDecimal(negative ? -magnitude : magnitude, scale);
}

/** The arithmetic mean of `values`; `0` for an empty input. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The population standard deviation of `values`; `0` for fewer than two points. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** A least-squares fit over `y` at x = 0..n−1, with its residuals. */
export interface LinearFit {
  readonly slope: number;
  readonly intercept: number;
  /** The fitted value at each history index. */
  readonly fitted: readonly number[];
  /** The residuals `y − fitted`. */
  readonly residuals: readonly number[];
  /**
   * The residual standard deviation `√(Σr² / (n − 2))`, or `null` when fewer
   * than three points (no residual degrees of freedom).
   */
  readonly residualStdDev: number | null;
}

/**
 * Fits an ordinary least-squares straight line `y = intercept + slope·x` over
 * `y` at x = 0..n−1 and returns the fitted values and residuals. Floating point
 * internally (a model, never a reported fact). Throws for fewer than two points
 * — the caller decides when history is too short to fit.
 */
export function linearFit(y: readonly number[]): LinearFit {
  const n = y.length;
  if (n < 2) {
    throw new DomainError("a least-squares fit needs at least two points");
  }
  const meanX = (n - 1) / 2;
  const meanY = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    sxx += dx * dx;
    sxy += dx * (y[i]! - meanY);
  }
  // sxx is zero only when n === 1 (excluded above), so this cannot divide by zero.
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const fitted = y.map((_, i) => intercept + slope * i);
  const residuals = y.map((value, i) => value - fitted[i]!);
  const residualStdDev =
    n >= 3 ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2)) : null;
  return { slope, intercept, fitted, residuals, residualStdDev };
}

/**
 * The mean absolute percentage error over the history: the mean of
 * `|actual − fitted| / |actual|` at the points where `actual` is non-zero, or
 * `null` when no actual is non-zero. A fraction, not a percentage.
 */
export function meanAbsolutePercentageError(
  actual: readonly number[],
  fitted: readonly number[],
): number | null {
  let total = 0;
  let count = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const value = actual[i]!;
    if (value === 0) {
      continue;
    }
    total += Math.abs(value - (fitted[i] ?? 0)) / Math.abs(value);
    count += 1;
  }
  return count === 0 ? null : total / count;
}
