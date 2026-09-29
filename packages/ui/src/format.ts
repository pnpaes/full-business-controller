/**
 * Money and number display helpers for tables, KPIs and chart axes
 * (`docs/ux/README.md`, cross-cutting finding #6: "numbers and money are raw").
 *
 * **Decimal strings only — never floats.** Every function operates on a
 * canonical decimal string (`"1234.5000"`), splitting the integer and
 * fractional parts textually and rounding with string arithmetic. Nothing is
 * ever parsed to a JavaScript number, so no precision is lost and the result
 * agrees with the domain's `HALF_UP` display rules. This module is
 * presentation-only and has no dependency on `@aquarela/domain`.
 *
 * Signature conventions:
 * - `formatMoney(value, { currency })` → grouped value with the currency
 *   appended (`"12,345.60 NOK"`), the same suffix shape the app already uses.
 * - `formatNumber(value, { decimals })` → grouped, fixed-decimal value.
 * - `groupDecimal(value)` → grouping only, no rounding (already-scaled input).
 * - `formatAxisValue(value, unit)` / `axisLabel(subject, unit)` → the chart
 *   axis convention: every tick names its unit, every axis names its subject
 *   and unit.
 */

export interface DecimalFormatOptions {
  /** Decimal places to round/pad to. Default 2. */
  decimals?: number;
  /** Thousands separator. Default ",". */
  groupSeparator?: string;
  /** Decimal separator. Default ".". */
  decimalSeparator?: string;
}

export interface MoneyFormatOptions extends DecimalFormatOptions {
  /** ISO 4217 code or symbol appended after the grouped value (e.g. "NOK", "€"). */
  currency?: string;
}

interface Parts {
  sign: string;
  int: string;
  frac: string;
}

function splitDecimal(value: string): Parts {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const body = trimmed.replace(/^[+-]/, "");
  const segments = body.split(".");
  if (segments.length > 2) {
    throw new Error(`Invalid decimal string: ${value}`);
  }
  const integerPart = segments[0] ?? "0";
  const fractionPart = segments[1] ?? "";
  const int = integerPart === "" ? "0" : integerPart.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(int) || !/^\d*$/.test(fractionPart)) {
    throw new Error(`Invalid decimal string: ${value}`);
  }
  return { sign: negative ? "-" : "", int, frac: fractionPart };
}

function groupInteger(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Rounds `frac` to `decimals` places HALF_UP, returning the kept fraction and any carry into the integer. */
function roundFraction(frac: string, decimals: number): { frac: string; carry: number } {
  if (frac.length <= decimals) {
    return { frac: frac.padEnd(decimals, "0"), carry: 0 };
  }
  const kept = frac.slice(0, decimals);
  const nextDigit = frac.charCodeAt(decimals);
  const roundUp = nextDigit >= 53; // charCode "5"
  if (!roundUp) {
    return { frac: kept, carry: 0 };
  }
  if (decimals === 0) {
    return { frac: "", carry: 1 };
  }
  const incremented = (BigInt(kept) + 1n).toString().padStart(decimals, "0");
  if (incremented.length > decimals) {
    return { frac: incremented.slice(-decimals), carry: 1 };
  }
  return { frac: incremented, carry: 0 };
}

/** Groups a decimal string with thousands separators; no rounding, no parsing. */
export function groupDecimal(value: string, separator = ",", decimalSeparator = "."): string {
  const { sign, int, frac } = splitDecimal(value);
  const grouped = groupInteger(int, separator);
  const withFraction = frac.length > 0 ? `${grouped}${decimalSeparator}${frac}` : grouped;
  return `${sign}${withFraction}`;
}

/** Grouped, fixed-decimal number string (HALF_UP). Never parses to a float. */
export function formatNumber(value: string, options: DecimalFormatOptions = {}): string {
  const { decimals = 2, groupSeparator = ",", decimalSeparator = "." } = options;
  const { sign, int, frac } = splitDecimal(value);
  const rounded = roundFraction(frac, decimals);
  const integerRounded = (BigInt(int) + BigInt(rounded.carry)).toString();
  const grouped = groupInteger(integerRounded, groupSeparator);
  const withFraction = decimals > 0 ? `${grouped}${decimalSeparator}${rounded.frac}` : grouped;
  return `${sign}${withFraction}`;
}

/** Grouped, fixed-decimal money string with the currency appended (`"12,345.60 NOK"`). */
export function formatMoney(value: string, options: MoneyFormatOptions = {}): string {
  const { currency, ...decimalOptions } = options;
  const formatted = formatNumber(value, decimalOptions);
  return currency ? `${formatted} ${currency}` : formatted;
}

/** A chart axis tick: a grouped, fixed-decimal value with its unit. */
export function formatAxisValue(
  value: string,
  unit?: string,
  options: DecimalFormatOptions = {},
): string {
  const formatted = formatNumber(value, options);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * The axis caption convention: always name the subject **and** the unit, e.g.
 * `axisLabel("Amount", "NOK")` → `"Amount (NOK)"`, `axisLabel("Quantity", "kg")`
 * → `"Quantity (kg)"`, `axisLabel("Food cost %")` → `"Food cost %"`.
 */
export function axisLabel(subject: string, unit?: string): string {
  return unit ? `${subject} (${unit})` : subject;
}

/**
 * A plain relative age for freshness lines: `just now`, then `5m`, `3h`, `2d`.
 * Accepts a `Date` or an ISO string; a **future** instant is clamped to
 * "just now" rather than reporting a negative age. Presentation-only, like the
 * money helpers above.
 */
export function formatRelativeAge(value: Date | string, now: Date = new Date()): string {
  const instant = typeof value === "string" ? new Date(value) : value;
  const minutes = Math.max(0, Math.floor((now.getTime() - instant.getTime()) / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
