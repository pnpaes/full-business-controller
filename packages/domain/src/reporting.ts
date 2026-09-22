import { formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { contributionMarginPct, unitNetSales } from "./pricing";

/**
 * Sales & margin reporting primitives (`RPT-001`–`RPT-003`, `ADR-0007`).
 *
 * The metric definitions live here once (`02:59`, `ADR-0007`) and are reused by
 * the application read model; the persistence group-by mirrors
 * `netSalesFromLine`'s source preference in SQL rather than inventing a second
 * rule. Decimal only (never floats); HALF_UP at the named money boundary
 * (`DEC-024`). A malformed input is a `DomainError`, never a silent default.
 */

/** The reporting grains a sales report may be bucketed by (`DEC-032`). */
export const SALES_REPORT_GRAINS = ["day", "week", "month"] as const;
export type SalesReportGrain = (typeof SALES_REPORT_GRAINS)[number];

/** True when `value` is one of `SALES_REPORT_GRAINS`. */
export function isSalesReportGrain(value: string): value is SalesReportGrain {
  return (SALES_REPORT_GRAINS as readonly string[]).includes(value);
}

/** `YYYY-MM-DD` in UTC. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM` in UTC. */
function isoMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The ISO-8601 week bucket (`YYYY-Www`, Monday–Sunday, `DEC-032`). The week's
 * year is the ISO week-numbering year, which can differ from the calendar year
 * around 1 January (e.g. 2021-01-01 is `2020-W53`), so the Thursday of the
 * week carries both the year and the week number.
 */
function isoWeek(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoWeekday = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay();
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoWeekday);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * The period bucket of `isoInstant` at `grain` (`RPT-001`, `DEC-032`): `day` ⇒
 * `YYYY-MM-DD`, `week` ⇒ ISO-8601 `YYYY-Www` (Monday–Sunday), `month` ⇒
 * `YYYY-MM`, all in UTC. An unknown grain or an unparseable instant is a
 * `DomainError`.
 */
export function periodBucket(grain: SalesReportGrain, isoInstant: string): string {
  if (!isSalesReportGrain(grain)) {
    throw new DomainError(`unknown sales report grain "${grain}"`);
  }
  const time = Date.parse(isoInstant);
  if (Number.isNaN(time)) {
    throw new DomainError(`"${isoInstant}" is not a valid ISO-8601 instant`);
  }
  const date = new Date(time);
  if (grain === "day") {
    return isoDay(date);
  }
  if (grain === "month") {
    return isoMonth(date);
  }
  return isoWeek(date);
}

/** The per-line money fields `netSalesFromLine` resolves. Null = not reported. */
export interface SalesLineNetInput {
  /** The line's gross amount; null/blank is treated as `"0"`. */
  readonly grossAmount: string | null;
  /** The line's included tax amount; null/blank is treated as `"0"`. */
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  /** The source-reported net amount; when present it wins verbatim. */
  readonly netAmount: string | null;
}

/** True when an optional decimal string carries a value. */
function isPresent(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/**
 * `net_sales` for one line (`CALCULATION_CONTRACT` §8, `SALE-009`): the source's
 * `net_amount` when it reported one, else `gross − included_tax − discount −
 * refund`, derived by handing the tax-exclusive gross to `unitNetSales` (the
 * exclusive basis subtracts the discount and refund). All amounts are decimal
 * strings; a malformed value is a `DomainError`.
 *
 * ponytail: the source preference is fixed here — a reported `net_amount` wins
 * over the derived value. Ceiling: a channel that reports a net amount
 * inconsistent with its gross/tax has no reconciliation path. Upgrade path: a
 * per-source preference policy if a channel ever needs a different precedence.
 */
export function netSalesFromLine(input: SalesLineNetInput): string {
  if (isPresent(input.netAmount)) {
    return formatDecimal(parseDecimal(input.netAmount, MONEY_SCALE), MONEY_SCALE);
  }
  const gross = parseDecimal(isPresent(input.grossAmount) ? input.grossAmount : "0", MONEY_SCALE);
  const tax = parseDecimal(isPresent(input.taxAmount) ? input.taxAmount : "0", MONEY_SCALE);
  return unitNetSales({
    grossSales: formatDecimal(gross - tax, MONEY_SCALE),
    taxBasis: "exclusive",
    taxRate: "0",
    discount: isPresent(input.discountAmount) ? input.discountAmount : "0",
    refund: isPresent(input.refundAmount) ? input.refundAmount : "0",
  });
}

/**
 * `contribution_before_labour = net_sales − ingredient_cost` (`04:68`). Both
 * sides are decimal strings; a malformed value is a `DomainError`. The result
 * may be negative (a period can sell below its ingredient cost). Direct labour,
 * channel fees and allocated overhead are **not** included — they are not
 * computable today (no cost-card composition assembler), so this is explicitly
 * a contribution **before** them, never a full cost.
 */
export function contributionBeforeLabour(netSales: string, ingredientCost: string): string {
  const net = parseDecimal(netSales, MONEY_SCALE);
  const cost = parseDecimal(ingredientCost, MONEY_SCALE);
  return formatDecimal(net - cost, MONEY_SCALE);
}

/**
 * `contribution_margin_pct = contribution / net_sales × 100`, at 6 dp
 * (`DEC-063`), or `null` when `net_sales <= 0` — the percentage is undefined
 * and must render as "n/a", never 0 (`04:71`). Thin, explicitly-named wrapper
 * over `contributionMarginPct` so the report's "or null" contract reads at the
 * call site.
 */
export function contributionMarginPctOrNull(netSales: string, contribution: string): string | null {
  return contributionMarginPct(netSales, contribution);
}
