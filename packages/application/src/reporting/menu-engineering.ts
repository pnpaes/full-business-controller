import {
  DomainError,
  MENU_ENGINEERING_CONTRIBUTION_NOTE,
  MENU_ENGINEERING_THRESHOLD_CATEGORY_MEDIAN,
  MENU_ENGINEERING_THRESHOLD_MEDIAN,
  MENU_ENGINEERING_THRESHOLD_NOTE,
  contributionBeforeLabour,
  isHighAgainst,
  isSalesReportGrain,
  medianDecimal,
  type MenuEngineeringThresholdStatistic,
  type SalesReportGrain,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import {
  SALES_REPORT_CURRENCY,
  SALES_REPORT_UNMAPPED_KEY,
  type ReportingStore,
  type SalesGroupRow,
  type WasteByProductVariantRow,
} from "./types";

/**
 * The menu-engineering report (`RPT-005`, `DEC-109`, `04_CALCULATIONS.md` §4.11):
 * each product classified `high`/`low` on **popularity** (period units against
 * the median of the per-product units) and on **contribution before labour/fees**
 * (against the median within the product's own category). Both thresholds are
 * **computed** from the report window — never configured, and no approved-target
 * table exists (`DEC-109` item 1/2) — and the response echoes the statistic, its
 * value, its scope and the source period rather than only a label.
 *
 * The measures are not re-derived here: the per-product units, net sales,
 * ingredient cost and contribution come from `summarizeSales` with
 * `groupBy: "product"` (the metric definitions live once, `ADR-0007`). The
 * classic Star/Puzzle/Horse/Dog names are deliberately **not** used
 * (`DEC-109` item 2): a row carries the two high/low flags and the threshold it
 * was measured against.
 *
 * Annotations are attached only where a rule exists (`DEC-109` item 5): the
 * product's `productKind` and the option kinds of its lines, plus waste
 * quantity/value **only** where `waste_event.product_variant_id` is set. Direct
 * labour, channel fees, allocated overhead, forecast reliability and strategic
 * role have no per-product attribution rule and are not shown.
 *
 * This is a read: no audit fact is written (`ADR-0007`).
 */

/** A safety ceiling on the row list; beyond it the report is truncated. */
export const MENU_ENGINEERING_MAX_ROWS = 500;

/** The caveat raised when the window has lines with no resolved product variant. */
export const MENU_ENGINEERING_UNMAPPED_NOTE =
  "lines with no resolved product variant or category are not classified and are reported as the unmapped bucket";

/** The caveat raised when the row list hit `MENU_ENGINEERING_MAX_ROWS`. */
export const MENU_ENGINEERING_TRUNCATED_NOTE =
  "the row list was capped; the thresholds are still computed over every product in scope";

/** The caveat explaining why the response-level contribution threshold is null. */
export const MENU_ENGINEERING_CATEGORY_THRESHOLD_NOTE =
  "the contribution threshold is category-relative, so it has no single value: each row carries its own category's median";

export interface BuildMenuEngineeringReportInput {
  readonly organizationId: string;
  /** Inclusive lower bound; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound; an ISO instant. */
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string;
}

/** The echoed filters a menu-engineering report was produced with (`FND-006`). */
export interface MenuEngineeringScope {
  /** `null` = organization-wide. */
  readonly locationIds: readonly string[] | null;
  readonly channelId: string | null;
}

/** One computed threshold: its statistic, value, scope and source period. */
export interface MenuEngineeringThreshold {
  readonly statistic: MenuEngineeringThresholdStatistic;
  readonly source: "computed";
  /** `null` only when nothing was in scope, or when the statistic is category-relative. */
  readonly value: string | null;
  readonly scope: MenuEngineeringScope;
  /** The window the threshold was derived from. */
  readonly sourcePeriod: { readonly start: string; readonly end: string };
}

/** The waste annotation for a product, present only where a variant is named. */
export interface MenuEngineeringWaste {
  /** `numeric(19,6)` quantity string, summed unit-blind (a recorded ceiling). */
  readonly quantity: string;
  /** `numeric(19,4)` money string; `null` when no waste event carried a value. */
  readonly value: string | null;
}

/** One classified product row. */
export interface MenuEngineeringRow {
  /** Never null: the `unmapped` bucket is reported separately. */
  readonly productVariantId: string;
  readonly label: string;
  readonly category: string | null;
  readonly productKind: string | null;
  /** The distinct option kinds of the product's lines; empty when unknown. */
  readonly optionKinds: readonly string[];
  readonly units: string;
  readonly netSales: string;
  readonly ingredientCost: string;
  readonly contributionBeforeLabour: string;
  /** `units >= popularity threshold` (`DEC-109` item 1). */
  readonly popularityHigh: boolean;
  /** `contribution >= the row's category median` (`DEC-109` item 1). */
  readonly contributionHigh: boolean;
  /** The median this row's contribution was measured against (its category's). */
  readonly contributionThreshold: string | null;
  readonly waste: MenuEngineeringWaste | null;
}

/** The unmapped bucket: lines with no resolved variant, never dropped. */
export interface MenuEngineeringUnmapped {
  readonly units: string;
  readonly netSales: string;
}

export interface MenuEngineeringReport {
  /** When the report was assembled; ISO. */
  readonly asOf: string;
  readonly scope: MenuEngineeringScope;
  readonly period: { readonly from: string; readonly to: string };
  readonly grain: SalesReportGrain;
  readonly currency: typeof SALES_REPORT_CURRENCY;
  readonly threshold: {
    readonly popularity: MenuEngineeringThreshold;
    readonly contribution: MenuEngineeringThreshold;
  };
  readonly rows: readonly MenuEngineeringRow[];
  readonly unmapped: MenuEngineeringUnmapped | null;
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

/** The median contribution within each category, keyed by `product.category`. */
function categoryThresholds(
  products: readonly { readonly row: SalesGroupRow; readonly contribution: string }[],
): Map<string | null, string> {
  const byCategory = new Map<string | null, string[]>();
  for (const { row, contribution } of products) {
    const list = byCategory.get(row.category) ?? [];
    list.push(contribution);
    byCategory.set(row.category, list);
  }
  const thresholds = new Map<string | null, string>();
  for (const [category, contributions] of byCategory) {
    // `contributions` is non-empty (a category only exists once a product was
    // pushed), so `medianDecimal` never returns null here.
    thresholds.set(category, medianDecimal(contributions)!);
  }
  return thresholds;
}

/**
 * Builds the report. `from`/`to` must be ISO instants with `from <= to`
 * (inclusive bounds) and `grain` a known value; anything else is a
 * `DomainError` before the store is touched. An empty `locationIds` reads as
 * organization-wide, never "scoped to nothing".
 *
 * The popularity median is taken over the **resolved** products only (the
 * `unmapped` bucket is not a product); the contribution median is taken within
 * each category, with a null category forming its own group. Both are computed
 * over every product in scope, before the `MENU_ENGINEERING_MAX_ROWS` cap.
 */
export async function buildMenuEngineeringReport(
  store: ReportingStore,
  input: BuildMenuEngineeringReportInput,
): Promise<MenuEngineeringReport> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  assertIsoInstant(input.from, "from");
  assertIsoInstant(input.to, "to");
  if (Date.parse(input.from) > Date.parse(input.to)) {
    throw new DomainError("from must be on or before to");
  }
  if (!isSalesReportGrain(input.grain)) {
    throw new DomainError(`unknown sales report grain "${String(input.grain)}"`);
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
    groupBy: "product",
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
  });

  const productRows = summary.rows.filter((row) => row.productVariantId !== null);
  const unmappedRow = summary.rows.find((row) => row.key === SALES_REPORT_UNMAPPED_KEY);

  const products = productRows.map((row) => ({
    row,
    contribution: contributionBeforeLabour(row.netSales, row.ingredientCost),
  }));

  const popularityThreshold = medianDecimal(productRows.map((row) => row.units));
  const contributionThresholds = categoryThresholds(products);

  const wasteRows = await store.sumWasteByProductVariant({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    ...(locationIds === null ? {} : { locationIds }),
  });
  const wasteByVariant = new Map<string, WasteByProductVariantRow>(
    wasteRows.map((row) => [row.productVariantId, row]),
  );

  const allRows: MenuEngineeringRow[] = products.map(({ row, contribution }) => {
    // Every product's category was a key in the map (both are built from the
    // same `products`), so the lookup is defined.
    const categoryThreshold = contributionThresholds.get(row.category)!;
    const waste = wasteByVariant.get(row.productVariantId!);
    return {
      productVariantId: row.productVariantId!,
      label: row.label,
      category: row.category,
      productKind: row.productKind,
      optionKinds: row.optionKinds,
      units: row.units,
      netSales: row.netSales,
      ingredientCost: row.ingredientCost,
      contributionBeforeLabour: contribution,
      popularityHigh: popularityThreshold !== null && isHighAgainst(row.units, popularityThreshold),
      contributionHigh: isHighAgainst(contribution, categoryThreshold),
      contributionThreshold: categoryThreshold,
      waste: waste === undefined ? null : { quantity: waste.quantity, value: waste.value },
    };
  });

  const truncated = allRows.length > MENU_ENGINEERING_MAX_ROWS;
  const rows = truncated ? allRows.slice(0, MENU_ENGINEERING_MAX_ROWS) : allRows;

  const scope: MenuEngineeringScope = {
    locationIds,
    channelId: input.channelId ?? null,
  };
  const sourcePeriod = { start: input.from, end: input.to };

  const notes: string[] = [
    MENU_ENGINEERING_THRESHOLD_NOTE,
    MENU_ENGINEERING_CONTRIBUTION_NOTE,
    MENU_ENGINEERING_CATEGORY_THRESHOLD_NOTE,
  ];
  if (unmappedRow !== undefined) {
    notes.push(MENU_ENGINEERING_UNMAPPED_NOTE);
  }
  if (truncated) {
    notes.push(MENU_ENGINEERING_TRUNCATED_NOTE);
  }

  return {
    asOf: new Date().toISOString(),
    scope,
    period: { from: input.from, to: input.to },
    grain: input.grain,
    currency: SALES_REPORT_CURRENCY,
    threshold: {
      popularity: {
        statistic: MENU_ENGINEERING_THRESHOLD_MEDIAN,
        source: "computed",
        value: popularityThreshold,
        scope,
        sourcePeriod,
      },
      contribution: {
        statistic: MENU_ENGINEERING_THRESHOLD_CATEGORY_MEDIAN,
        source: "computed",
        // Null by design: the contribution threshold is category-relative, so it
        // has no single value — each row carries its own category's median
        // (`DEC-109` item 2, MENU_ENGINEERING_CATEGORY_THRESHOLD_NOTE).
        value: null,
        scope,
        sourcePeriod,
      },
    },
    rows,
    unmapped:
      unmappedRow === undefined
        ? null
        : { units: unmappedRow.units, netSales: unmappedRow.netSales },
    truncated,
    notes,
  };
}
