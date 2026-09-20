import { formatDecimal, parseDecimal, rescale } from "@aquarela/domain";

/**
 * Presentation helpers for the production screens (08_UI_UX.md §8.3, §8.6).
 * Kept free of Next/DB imports so any screen or table can reuse them; the
 * status vocabulary mirrors `PRODUCTION_STATUS` in `@aquarela/persistence`
 * without importing it, so a server component does not pull the persistence
 * bundle in (the waste screen's labels follow the same convention).
 */

export type ProductionStatusTone = "info" | "success" | "warning" | "danger";

/**
 * Batch status → pill tone/label (`planned` → `cancelled`). The plan header has
 * no vocabulary authority (open point (f)), so an unknown value falls back to a
 * neutral label rather than being hidden.
 */
export const PRODUCTION_STATUS_VIEW: Record<string, { tone: ProductionStatusTone; label: string }> =
  {
    planned: { tone: "info", label: "Planned" },
    released: { tone: "info", label: "Released" },
    in_progress: { tone: "warning", label: "In progress" },
    completed: { tone: "success", label: "Completed" },
    cancelled: { tone: "danger", label: "Cancelled" },
  };

export function productionStatusView(status: string): {
  tone: ProductionStatusTone;
  label: string;
} {
  return PRODUCTION_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** Ledger/date rate scale (`rate` = numeric(9,6)); not exported by the domain. */
const RATE_SCALE = 6;

/** ISO instant → "2026-09-20 08:00 UTC". */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Trims trailing zeros from a canonical decimal string without changing its value. */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

/** numeric(19,6) quantity → "17.5 g" (or an em dash when absent). */
export function quantityLabel(value: string | null, unitCode: string | null): string {
  if (value === null) {
    return "—";
  }
  return `${trimDecimal(value)}${unitCode === null ? "" : ` ${unitCode}`}`;
}

/** `yield_variance_pct` is a signed fraction (numeric(9,6)), not already a percent. */
export function yieldVarianceLabel(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const percent = rescale(parseDecimal(value, RATE_SCALE), RATE_SCALE, 2);
  const formatted = `${formatDecimal(percent < 0n ? -percent : percent, 2)}%`;
  return percent < 0n ? `-${formatted}` : percent > 0n ? `+${formatted}` : formatted;
}

/** True when a completed batch's yield variance is non-zero. */
export function hasYieldVariance(value: string | null): boolean {
  return value !== null && parseDecimal(value, RATE_SCALE) !== 0n;
}

export function orDash(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}
