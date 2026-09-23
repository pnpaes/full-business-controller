import { SALES_REPORT_GROUP_BYS, type SalesReportGroupBy } from "@aquarela/application";
import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  SALES_REPORT_GRAINS,
  TAX_RATE_SCALE,
  formatDecimal,
  parseDecimal,
  rescale,
  type SalesReportGrain,
} from "@aquarela/domain";

/**
 * Presentation helpers for the sales & margin reporting screens (`RPT-001`–
 * `RPT-003`, `FND-006`, `08_UI_UX.md` §8.4). Kept free of Next/DB/persistence
 * imports so both the Management home and the Insights report page reuse them.
 *
 * Decimal strings stay decimal through formatting (`DEC-024`): money is
 * presented at 2 dp, quantities at 3 dp with trailing zeros trimmed, and a
 * percentage at 1 dp (or "n/a" when undefined). The only float is the sparkline
 * point, which is a chart coordinate, not a reported figure.
 */

/** The three grain options in selector order. */
export const GRAIN_OPTIONS: readonly SalesReportGrain[] = SALES_REPORT_GRAINS;

/** `day` → "Daily", `week` → "Weekly", `month` → "Monthly". */
export const GRAIN_LABELS: Record<SalesReportGrain, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

/** True when `value` is one of the reporting grains. */
export function isGrain(value: string): value is SalesReportGrain {
  return (SALES_REPORT_GRAINS as readonly string[]).includes(value);
}

/** The group-by options in selector order. */
export const GROUP_BY_OPTIONS: readonly SalesReportGroupBy[] = SALES_REPORT_GROUP_BYS;

/** `location` → "Location", … `period` → "Period". */
export const GROUP_BY_LABELS: Record<SalesReportGroupBy, string> = {
  location: "Location",
  channel: "Channel",
  category: "Category",
  product: "Product",
  period: "Period",
};

/** True when `value` is one of the reporting group-by dimensions. */
export function isGroupBy(value: string): value is SalesReportGroupBy {
  return (SALES_REPORT_GROUP_BYS as readonly string[]).includes(value);
}

export interface ReportPeriod {
  /** Inclusive lower bound; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound; an ISO instant (the current instant). */
  readonly to: string;
  /** A human label such as "2026-09 month-to-date". */
  readonly label: string;
}

/**
 * The window for a grain ending at `now` (UTC): `day` is the current UTC day,
 * `week` is the ISO week so far (Monday–Sunday, `DEC-032`), `month` is the
 * current month to date. The upper bound is `now`, so a dashboard never shows a
 * future period.
 */
export function periodForGrain(grain: SalesReportGrain, now: Date): ReportPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const to = now.toISOString();
  if (grain === "day") {
    const from = new Date(Date.UTC(year, month, date));
    return { from: from.toISOString(), to, label: `${from.toISOString().slice(0, 10)} (today)` };
  }
  if (grain === "week") {
    const isoWeekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    const from = new Date(Date.UTC(year, month, date - (isoWeekday - 1)));
    return { from: from.toISOString(), to, label: `week of ${from.toISOString().slice(0, 10)}` };
  }
  const from = new Date(Date.UTC(year, month, 1));
  return { from: from.toISOString(), to, label: `${from.toISOString().slice(0, 7)} month-to-date` };
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

/** A 6 dp margin percentage → "67.5%", or "n/a" when undefined (`DEC-063`). */
export function formatPct(value: string | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${formatDecimal(rescale(parseDecimal(value, TAX_RATE_SCALE), TAX_RATE_SCALE, 1), 1)}%`;
}

/** An ISO instant → "2026-09-22 14:30 UTC" (the `FND-006` freshness label). */
export function formatAsOf(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** The minimal location scope the report meta line needs (sales and operational reports). */
export interface ReportScopeLocationIds {
  /** `null` = organization-wide. */
  readonly locationIds: readonly string[] | null;
}

/** The echoed scope as a short label: "All locations" or "N locations". */
export function scopeLabel(scope: ReportScopeLocationIds): string {
  if (scope.locationIds === null) {
    return "All locations";
  }
  return `${scope.locationIds.length} ${scope.locationIds.length === 1 ? "location" : "locations"}`;
}

/** The `FND-006` meta line: period · scope · freshness. */
export function metaLine(
  period: ReportPeriod,
  scope: ReportScopeLocationIds,
  asOf: string,
): string {
  return `${period.label} · ${scopeLabel(scope)} · as of ${formatAsOf(asOf)}`;
}

/**
 * The sparkline y-values from the period groups' net sales. The value is a
 * chart coordinate (a float) — never a reported figure; the table and KPIs keep
 * the decimal string.
 */
export function sparklinePoints(
  groups: readonly { readonly netSales: string }[],
): readonly number[] {
  return groups.map((group) => Number(group.netSales));
}
