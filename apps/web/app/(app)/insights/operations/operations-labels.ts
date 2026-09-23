import type { OperationsReport, OperationsReportSection } from "@aquarela/application";
import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  TAX_RATE_SCALE,
  divideRoundHalfUp,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";

/**
 * Presentation helpers for the operational-report screen (`RPT-004`, `FND-006`,
 * `08_UI_UX.md` §8.4). Kept free of Next/DB imports so the page (and its test)
 * reuse them. Decimal strings stay decimal through formatting (`DEC-024`).
 */

/** The `DEC-018` stage axis in display order, with a human label each. */
export const WASTE_STAGE_LABELS: Record<string, string> = {
  receiving: "Receiving",
  storage_expiry: "Storage / expiry",
  preparation: "Preparation",
  production: "Production",
  display: "Display",
  unsold_finished_goods: "Unsold finished goods",
  customer_return: "Customer return",
  count_discovered: "Count discovered",
  other: "Other",
};

/** The human label for a `DEC-018` stage; falls back to the raw stage. */
export function wasteStageLabel(stage: string): string {
  return WASTE_STAGE_LABELS[stage] ?? stage;
}

/**
 * A stored 6 dp **fraction** as a 1 dp percentage string ("-10.0%"), or "n/a"
 * when undefined. Decimal only: the fraction is scaled by 1000 (×100 for the
 * percent, ×10 for one decimal place) and rounded HALF_UP (`DEC-024`).
 */
export function formatFractionPct(value: string | null): string {
  if (value === null) {
    return "n/a";
  }
  const scaled = parseDecimal(value, TAX_RATE_SCALE);
  const tenths = divideRoundHalfUp(scaled * 1000n, 10n ** BigInt(TAX_RATE_SCALE));
  return `${formatDecimal(tenths, 1)}%`;
}

/** A 6 dp ratio as a 2 dp string ("0.90"), or "n/a" when undefined. */
export function formatRatio(value: string | null): string {
  if (value === null) {
    return "n/a";
  }
  return formatDecimal(rescale(parseDecimal(value, TAX_RATE_SCALE), TAX_RATE_SCALE, 2), 2);
}

/** `numeric(19,4)` money → a 2 dp display string (`DEC-024`). */
export function formatMoney(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

/** `numeric(19,6)` quantity → a 3 dp display string with trailing zeros trimmed. */
export function formatQuantity(value: string): string {
  const atThree = formatDecimal(rescale(parseDecimal(value, QUANTITY_SCALE), QUANTITY_SCALE, 3), 3);
  return atThree.replace(/\.?0+$/, "");
}

/**
 * The section-level drill-down href (`RPT-002`): the records route with the
 * report's section, window and the caller's location scope, so a multi-location
 * caller's drill-down matches the report they read. The stock-value section's
 * window is its point-in-time `stockValue.asOf`, echoed as `asOf` so the
 * drill-down cannot disagree with the report; the flow sections use the
 * half-open period and ignore it.
 */
export function operationsRecordsHref(
  section: OperationsReportSection,
  report: Pick<OperationsReport, "period" | "grain" | "scope"> & {
    readonly stockValue: Pick<OperationsReport["stockValue"], "asOf">;
  },
): string {
  const params = new URLSearchParams({
    section,
    from: report.period.from,
    to: report.period.to,
    grain: report.grain,
    asOf: report.stockValue.asOf,
  });
  if (report.scope.locationIds !== null && report.scope.locationIds.length > 0) {
    params.set("locationIds", report.scope.locationIds.join(","));
  }
  return `/api/v1/reports/operations/records?${params.toString()}`;
}
