import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  contributionBeforeLabour,
  contributionMarginPctOrNull,
  formatDecimal,
  isSalesReportGrain,
  parseDecimal,
  type SalesReportGrain,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import {
  SALES_REPORT_CURRENCY,
  SALES_REPORT_MAX_GROUPS,
  SALES_REPORT_UNMAPPED_KEY,
  isSalesReportGroupBy,
  type ReportingStore,
  type SalesGroupRow,
  type SalesMeasures,
  type SalesReportGroupBy,
} from "./types";

/**
 * Builds the sales & margin report (`RPT-001`, `ADR-0007`) for one window: the
 * window's sales lines grouped by one dimension, each group carrying its net
 * sales, ledger ingredient cost and **contribution before labour/fees**, plus
 * the period totals, the echoed scope and the metric caveats.
 *
 * Contribution here is `net_sales − ingredient_cost`, where the cost is the
 * moving-average value actually posted to the stock ledger. Direct labour,
 * channel fees and allocated overhead are **not computable today** (no cost-card
 * composition assembler has a production caller), so the report deliberately
 * stops at contribution **before** them and never claims a full cost — the
 * `notes` say so on every response.
 *
 * This is a read: no audit fact is written (`ADR-0007`).
 */

/** The contribution caveat carried on every response (`RPT-001`). */
export const SALES_REPORT_CONTRIBUTION_NOTE =
  "contribution excludes direct labour, channel fees and allocated overhead";

/** The ingredient-cost basis caveat. */
export const SALES_REPORT_INGREDIENT_COST_NOTE =
  "ingredient cost is the moving-average value posted to the stock ledger for each sales line; a line with no posted consumption contributes 0";

/** The caveat raised when the window has lines with no value for the grouped dimension. */
export const SALES_REPORT_UNMAPPED_NOTE =
  "some lines have no value for the grouped dimension and are grouped as 'unmapped'";

/** The caveat raised when the group list hit `SALES_REPORT_MAX_GROUPS`. */
export const SALES_REPORT_TRUNCATED_NOTE =
  "the group list was capped; the totals still cover every group";

export interface BuildSalesReportInput {
  readonly organizationId: string;
  /** The acting actor; carried for parity and a future audit. This read writes none. */
  readonly actorId: string;
  /** Inclusive lower bound; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound; an ISO instant. */
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly groupBy: SalesReportGroupBy;
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
}

/** The echoed filters a report was produced with (`FND-006`). */
export interface SalesReportScope {
  /** `null` = organization-wide. */
  readonly locationIds: readonly string[] | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
}

/** One report group: the grouped dimension plus the measures and contribution. */
export interface SalesReportGroup extends SalesMeasures {
  readonly key: string;
  readonly label: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly periodBucket: string;
  readonly contributionBeforeLabour: string;
  /** `null` when net sales are non-positive (`DEC-063`); renders as "n/a". */
  readonly contributionMarginPct: string | null;
}

/** The period totals, with the same contribution measures as a group. */
export interface SalesReportTotals extends SalesMeasures {
  readonly contributionBeforeLabour: string;
  readonly contributionMarginPct: string | null;
}

export interface SalesReport {
  /** When the report was assembled; ISO. */
  readonly asOf: string;
  readonly scope: SalesReportScope;
  readonly period: { readonly from: string; readonly to: string };
  readonly grain: SalesReportGrain;
  readonly currency: typeof SALES_REPORT_CURRENCY;
  readonly groupBy: SalesReportGroupBy;
  readonly groups: readonly SalesReportGroup[];
  readonly totals: SalesReportTotals;
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

/** Sums money strings at `MONEY_SCALE` (HALF_UP never applies to a sum). */
function sumMoney(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += parseDecimal(value, MONEY_SCALE);
  }
  return formatDecimal(total, MONEY_SCALE);
}

/** Sums quantity strings at `QUANTITY_SCALE`. */
function sumQuantity(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += parseDecimal(value, QUANTITY_SCALE);
  }
  return formatDecimal(total, QUANTITY_SCALE);
}

/** Adds the contribution measures to a row's money measures. */
function withContribution<T extends SalesMeasures>(
  measures: T,
): T & { contributionBeforeLabour: string; contributionMarginPct: string | null } {
  const contribution = contributionBeforeLabour(measures.netSales, measures.ingredientCost);
  return {
    ...measures,
    contributionBeforeLabour: contribution,
    contributionMarginPct: contributionMarginPctOrNull(measures.netSales, contribution),
  };
}

/** Maps a store group row to the report group, adding the contribution measures. */
function toReportGroup(row: SalesGroupRow): SalesReportGroup {
  return {
    key: row.key,
    label: row.label,
    locationId: row.locationId,
    channelId: row.channelId,
    category: row.category,
    productVariantId: row.productVariantId,
    periodBucket: row.periodBucket,
    ...withContribution({
      transactions: row.transactions,
      units: row.units,
      grossSales: row.grossSales,
      netSales: row.netSales,
      taxAmount: row.taxAmount,
      discountAmount: row.discountAmount,
      refundAmount: row.refundAmount,
      ingredientCost: row.ingredientCost,
    }),
  };
}

/**
 * Builds the report. `from`/`to` must be ISO instants with `from <= to`
 * (inclusive bounds), `grain` and `groupBy` must be known values; anything else
 * is a `DomainError` before the store is touched. The scope is normalized so an
 * empty `locationIds` reads as organization-wide, never "scoped to nothing".
 */
export async function buildSalesReport(
  store: ReportingStore,
  input: BuildSalesReportInput,
): Promise<SalesReport> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (isBlank(input.actorId)) {
    throw new DomainError("actorId is required");
  }
  assertIsoInstant(input.from, "from");
  assertIsoInstant(input.to, "to");
  if (Date.parse(input.from) > Date.parse(input.to)) {
    throw new DomainError("from must be on or before to");
  }
  if (!isSalesReportGrain(input.grain)) {
    throw new DomainError(`unknown sales report grain "${String(input.grain)}"`);
  }
  if (!isSalesReportGroupBy(input.groupBy)) {
    throw new DomainError(`unknown sales report groupBy "${String(input.groupBy)}"`);
  }

  const locationIds =
    input.locationIds === undefined || input.locationIds.length === 0
      ? null
      : [...input.locationIds];

  const summary = await store.summarizeSales({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    grain: input.grain,
    groupBy: input.groupBy,
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.productVariantId === undefined ? {} : { productVariantId: input.productVariantId }),
  });

  const allGroups = summary.rows.map(toReportGroup);
  const truncated = allGroups.length > SALES_REPORT_MAX_GROUPS;
  const groups = truncated ? allGroups.slice(0, SALES_REPORT_MAX_GROUPS) : allGroups;

  // `transactions` is the window-level distinct count from the store, not the
  // sum of the per-group counts: for `channel`/`category`/`product` one
  // transaction contributes to several groups and would otherwise be counted
  // repeatedly. It counts every in-window transaction that contributes at least
  // one non-`included` line (`SALE-011`); a transaction whose only lines are
  // `included` contributes no revenue/margin and is not counted.
  const totals = withContribution({
    transactions: summary.transactions,
    units: sumQuantity(allGroups.map((group) => group.units)),
    grossSales: sumMoney(allGroups.map((group) => group.grossSales)),
    netSales: sumMoney(allGroups.map((group) => group.netSales)),
    taxAmount: sumMoney(allGroups.map((group) => group.taxAmount)),
    discountAmount: sumMoney(allGroups.map((group) => group.discountAmount)),
    refundAmount: sumMoney(allGroups.map((group) => group.refundAmount)),
    ingredientCost: sumMoney(allGroups.map((group) => group.ingredientCost)),
  });

  const notes: string[] = [SALES_REPORT_CONTRIBUTION_NOTE, SALES_REPORT_INGREDIENT_COST_NOTE];
  if (allGroups.some((group) => group.key === SALES_REPORT_UNMAPPED_KEY)) {
    notes.push(SALES_REPORT_UNMAPPED_NOTE);
  }
  if (truncated) {
    notes.push(SALES_REPORT_TRUNCATED_NOTE);
  }

  return {
    asOf: new Date().toISOString(),
    scope: {
      locationIds,
      channelId: input.channelId ?? null,
      category: input.category ?? null,
      productVariantId: input.productVariantId ?? null,
    },
    period: { from: input.from, to: input.to },
    grain: input.grain,
    currency: SALES_REPORT_CURRENCY,
    groupBy: input.groupBy,
    groups,
    totals,
    truncated,
    notes,
  };
}
