import { MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";

/**
 * Small presentational helpers shared by the purchasing screens. Pure and
 * framework-free so both server components can use them without a client bundle.
 */

/** ISO instant → "2026-09-19 10:00 UTC" for a compact table cell. */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** `yyyy-mm-dd` (unchanged) or a dash. */
export function formatDate(value: string | null): string {
  return value ?? "—";
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

/** Monetary numeric(19,4) → 2dp display string, HALF_UP (DEC-024). */
export function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

/** Status label and tone for the receipt status vocabulary. */
export function statusView(status: string): {
  readonly tone: "success" | "warning" | "danger" | "info";
  readonly label: string;
} {
  switch (status) {
    case "accepted":
      return { tone: "success", label: "Accepted" };
    case "submitted":
      return { tone: "info", label: "Submitted" };
    case "rejected":
      return { tone: "danger", label: "Rejected" };
    case "reversed":
      return { tone: "danger", label: "Reversed" };
    default:
      return { tone: "warning", label: "Draft" };
  }
}
