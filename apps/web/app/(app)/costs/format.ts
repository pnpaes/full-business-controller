import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";

/**
 * Display formatting for the Costs screens. All money/quantity strings are
 * canonical decimals from the database; this module only trims them for the
 * screen (never re-derives a figure) and pairs every money value with its
 * currency at the call site (08_UI_UX.md §8.5).
 */

const PERCENT_SCALE = 6;

/** Trims trailing zeros from a canonical decimal string without changing its value. */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

/** A 4 dp money string → 2 dp for display (HALF_UP, DEC-024). */
export function formatMoney(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

/** A quantity string at display precision (trailing zeros trimmed). */
export function formatQuantity(value: string): string {
  return trimDecimal(formatDecimal(parseDecimal(value, QUANTITY_SCALE), QUANTITY_SCALE));
}

/** A 6 dp fraction (e.g. 0.253300) → a 2 dp percentage string (e.g. "25.33%"). */
export function formatPercent(value: string): string {
  const percent = rescale(parseDecimal(value, PERCENT_SCALE) * 100n, PERCENT_SCALE, 2);
  return `${formatDecimal(percent, 2)}%`;
}

/** ISO instant → "2026-09-20 12:42 UTC". */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** `effective_to` null → an open-ended window. */
export function formatWindow(from: string, to: string | null): string {
  return to === null ? `${from} → open` : `${from} → ${to}`;
}

export type StateTone = "info" | "success" | "warning" | "danger";

/** State → status tone; unknown states read as informational. */
export function stateTone(state: string): StateTone {
  switch (state) {
    case "approved":
      return "success";
    case "superseded":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "info";
  }
}

/** A null-or-empty display value rendered as an em dash. */
export function orDash(value: string | null): string {
  return value === null || value.length === 0 ? "—" : value;
}
