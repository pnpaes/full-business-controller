import type { SalesReportGrain } from "@aquarela/domain";

/**
 * Application-level ports and DTOs for the sales & margin reporting read model
 * (`RPT-001`–`RPT-003`, `ADR-0007`).
 *
 * This is an **on-demand** read over the canonical facts — no aggregate table
 * and no materialized view (the refresh job is gated on `ADR-0004`, still
 * `Proposed`), so the port is read-only: no audit fact is written. The metric
 * definitions live in the domain (`packages/domain/src/reporting.ts`) and the
 * group-by mirrors them; the port only shapes and labels the aggregates.
 *
 * Every query carries the organization and is scoped by it (`DEC-061`).
 */

/** The dimensions a sales report may be grouped by (`RPT-001`). */
export const SALES_REPORT_GROUP_BYS = [
  "location",
  "channel",
  "category",
  "product",
  "period",
] as const;
export type SalesReportGroupBy = (typeof SALES_REPORT_GROUP_BYS)[number];

/** True when `value` is one of `SALES_REPORT_GROUP_BYS`. */
export function isSalesReportGroupBy(value: string): value is SalesReportGroupBy {
  return (SALES_REPORT_GROUP_BYS as readonly string[]).includes(value);
}

/** The group key/label for lines with no location/channel/category/variant. */
export const SALES_REPORT_UNMAPPED_KEY = "unmapped";
export const SALES_REPORT_UNMAPPED_LABEL = "Unmapped";

/** Default page size of the RPT-002 drill-down when the caller omits `limit`. */
export const DEFAULT_SALES_REPORT_RECORD_LIMIT = 100;

/** A safety ceiling on the summary group list; beyond it the report is truncated. */
export const SALES_REPORT_MAX_GROUPS = 500;

/** The reporting currency (`DEC-104` hard-codes NOK; the organization's own). */
export const SALES_REPORT_CURRENCY = "NOK";

/** The line-level measures shared by a group and the report totals. */
export interface SalesMeasures {
  readonly transactions: number;
  /** `numeric(19,6)` quantity string. */
  readonly units: string;
  /** `numeric(19,4)` money strings. */
  readonly grossSales: string;
  readonly netSales: string;
  readonly taxAmount: string;
  readonly discountAmount: string;
  readonly refundAmount: string;
  readonly ingredientCost: string;
}

/** One grouped aggregate row; only the grouped dimension is populated. */
export interface SalesGroupRow extends SalesMeasures {
  /** The group identity (a dimension id, or `unmapped`, or the period bucket). */
  readonly key: string;
  /** A display label (a joined name, the category, or the bucket). */
  readonly label: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  /**
   * The product's `product.product_kind`; populated for a `product` group only
   * (null otherwise). Attached so menu engineering can annotate a product row
   * (`DEC-109` item 5) without a second read.
   */
  readonly productKind: string | null;
  /**
   * The distinct `sales_line.option_kind` values on the group's lines; populated
   * for a `product` group only (empty otherwise). `included` lines are already
   * excluded (`SALE-011`), so a product sold both standalone and as an attached
   * add-on carries both here (`DEC-109` item 3/5).
   */
  readonly optionKinds: readonly string[];
  readonly periodBucket: string;
}

/** One drill-down sales line (`RPT-002`). */
export interface SalesReportLineRow {
  readonly id: string;
  readonly salesTransactionId: string;
  /** `timestamptz`, ISO. */
  readonly occurredAt: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly sku: string | null;
  readonly externalProductRef: string | null;
  readonly externalLineId: string | null;
  readonly optionKind: string;
  /** `numeric(19,6)` quantity string. */
  readonly quantity: string;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly ingredientCost: string;
  readonly reversalOfId: string | null;
}

/** The filters a sales report read shares. */
export interface SalesReportFilters {
  readonly organizationId: string;
  /** Inclusive lower bound on `occurred_at`; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound on `occurred_at`; an ISO instant. */
  readonly to: string;
  readonly grain: SalesReportGrain;
  /**
   * The caller's location scope. `undefined` **or an empty list** means
   * organization-wide (the repo convention); a non-empty list restricts the
   * report to those locations.
   */
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
}

/** A `summarizeSales` read. */
export interface SalesSummaryQuery extends SalesReportFilters {
  readonly groupBy: SalesReportGroupBy;
}

/**
 * The result of `summarizeSales`: the per-group rows plus the **window-level**
 * distinct transaction count. The count is computed once over the whole filtered
 * window (ungrouped), so a transaction that spans several groups is counted once
 * for the report totals rather than once per group.
 */
export interface SalesSummary {
  readonly rows: readonly SalesGroupRow[];
  readonly transactions: number;
}

/** A `listSalesLineRecords` read. */
export interface SalesLineQuery extends SalesReportFilters {
  readonly limit: number;
  readonly offset: number;
}

/** One drill-down page with a conservative completeness flag. */
export interface SalesReportLineRowPage {
  readonly rows: readonly SalesReportLineRow[];
  /** True when more in-scope rows may exist beyond `limit` (never a silent short page). */
  readonly truncated: boolean;
}

/**
 * A waste read for menu engineering (`RPT-005`, `DEC-109` item 5). Waste is
 * joined only where `waste_event.product_variant_id` is set — no item→product
 * attribution rule exists — so this read is per product variant and org-scoped.
 */
export interface WasteByProductVariantQuery {
  readonly organizationId: string;
  /** Inclusive lower bound on `waste_event.occurred_at`; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound on `waste_event.occurred_at`; an ISO instant. */
  readonly to: string;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
}

/** One variant's summed waste over the window. */
export interface WasteByProductVariantRow {
  readonly productVariantId: string;
  /** `numeric(19,6)` quantity string, summed unit-blind (a recorded ceiling). */
  readonly quantity: string;
  /** `numeric(19,4)` money string summed over valued events; null when none. */
  readonly value: string | null;
}

/**
 * The persistence port for the reporting read model. Read-only: there is no
 * `writeAudit` because the slice writes no fact (`ADR-0007`: a read). There is
 * no `withTransaction` seam either: no caller needs to bind a multi-read report
 * to one transaction, and the reads are independent.
 */
export interface ReportingStore {
  /** Groups the window's sales lines by one dimension (`RPT-001`). */
  summarizeSales(query: SalesSummaryQuery): Promise<SalesSummary>;
  /** The drill-down page for the window (`RPT-002`). */
  listSalesLineRecords(query: SalesLineQuery): Promise<SalesReportLineRowPage>;
  /** The window's waste by product variant (`RPT-005`, `DEC-109` item 5). */
  sumWasteByProductVariant(
    query: WasteByProductVariantQuery,
  ): Promise<readonly WasteByProductVariantRow[]>;
  /** Point-in-time stock value by location (`RPT-004`, `DEC-110` item 1). */
  sumStockValueByLocationAsOf(
    query: StockValueByLocationQuery,
  ): Promise<readonly StockValueByLocationRow[]>;
  /** Approved count variance + booked adjustment value by location (`DEC-110` 2/3). */
  sumStockCountVariance(query: StockCountVarianceQuery): Promise<readonly StockCountVarianceRow[]>;
  /** Completed-batch yield inputs/outputs by location/recipe (`DEC-110` item 5). */
  sumProductionYield(query: ProductionYieldQuery): Promise<readonly ProductionYieldRow[]>;
  /** Waste by the `DEC-018` stage axis (`DEC-110` item 4). */
  sumWasteByStage(query: WasteByStageQuery): Promise<readonly WasteByStageRow[]>;
  /** The as-of ledger movements behind the stock-value section (`RPT-002`). */
  listStockValueRecords(query: StockValueRecordsQuery): Promise<StockValueRecordPage>;
  /** The approved count lines behind the stock-variance section (`RPT-002`). */
  listStockCountVarianceRecords(
    query: StockCountVarianceRecordsQuery,
  ): Promise<StockCountVarianceRecordPage>;
  /** The completed batches behind the production section (`RPT-002`). */
  listProductionYieldRecords(
    query: ProductionYieldRecordsQuery,
  ): Promise<ProductionYieldRecordPage>;
  /** The waste events behind the waste section (`RPT-002`). */
  listWasteStageRecords(query: WasteStageRecordsQuery): Promise<WasteStageRecordPage>;
}

/*
 * RPT-004 operational reporting port DTOs (rows 13e/13f, `DEC-110`).
 *
 * The four aggregate reads return pre-shaped rows; the application read model
 * sums the totals, derives the yield figures and caps the lists. Every money/
 * quantity field is a decimal string (never a float) and every read is
 * organization-scoped (`DEC-061`); an empty/undefined `locationIds` means
 * organization-wide (the repo convention). Every **flow** section (variance,
 * production, waste) shares one half-open `[from, to)` window (`DEC-110` item
 * 6); stock value is point-in-time `<= asOf` and not period-bounded.
 */

/** The four operational-report sections (`RPT-004`, `DEC-110`). */
export const OPERATIONS_REPORT_SECTIONS = [
  "stock_value",
  "stock_variance",
  "production",
  "waste",
] as const;
export type OperationsReportSection = (typeof OPERATIONS_REPORT_SECTIONS)[number];

/** True when `value` is one of `OPERATIONS_REPORT_SECTIONS`. */
export function isOperationsReportSection(value: string): value is OperationsReportSection {
  return (OPERATIONS_REPORT_SECTIONS as readonly string[]).includes(value);
}

/** A safety ceiling on each operational-report section; beyond it the report is truncated. */
export const OPERATIONS_REPORT_MAX_ROWS = 500;

/** Default page size of the RPT-002 operational drill-down when the caller omits `limit`. */
export const DEFAULT_OPERATIONS_REPORT_RECORD_LIMIT = 100;

/** A stock-value read (`DEC-110` item 1): point-in-time Σ value by location. */
export interface StockValueByLocationQuery {
  readonly organizationId: string;
  /** The valuation instant; an ISO instant. */
  readonly asOf: string;
  readonly locationIds?: readonly string[] | undefined;
}

export interface StockValueByLocationRow {
  readonly locationId: string;
  readonly locationName: string | null;
  /** `numeric(19,4)` money string. */
  readonly valueOnHand: string;
}

/** A stock-count variance read (`DEC-110` items 2/3). */
export interface StockCountVarianceQuery {
  readonly organizationId: string;
  /** Inclusive lower bound on `stock_count.cutoff`; an ISO instant. */
  readonly from: string;
  /** Exclusive upper bound on `stock_count.cutoff`; an ISO instant. */
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
}

export interface StockCountVarianceRow {
  readonly locationId: string;
  readonly locationName: string | null;
  readonly counts: number;
  /** `numeric(19,6)` quantity string. */
  readonly varianceQty: string;
  /** `numeric(19,4)` money string; the booked count-adjustment value. */
  readonly adjustmentValue: string;
}

/** A production-yield read (`DEC-110` item 5). */
export interface ProductionYieldQuery {
  readonly organizationId: string;
  /** Inclusive lower bound on `production_batch.actual_finish`; an ISO instant. */
  readonly from: string;
  /** Exclusive upper bound on `production_batch.actual_finish`; an ISO instant. */
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
}

export interface ProductionYieldRow {
  readonly locationId: string;
  readonly locationName: string | null;
  readonly recipeVersionId: string;
  readonly recipeName: string | null;
  readonly batches: number;
  /** `numeric(19,6)` quantity strings. */
  readonly plannedOutput: string;
  readonly actualOutput: string;
  /** `numeric(19,4)` money strings. */
  readonly inputValue: string;
  readonly outputValue: string;
}

/** A waste-by-stage read (`DEC-110` item 4). */
export interface WasteByStageQuery {
  readonly organizationId: string;
  /** Inclusive lower bound on `waste_event.occurred_at`; an ISO instant. */
  readonly from: string;
  /** Exclusive upper bound on `waste_event.occurred_at`; an ISO instant. */
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
}

export interface WasteByStageRow {
  readonly stage: string;
  readonly events: number;
  /** `numeric(19,6)` quantity string, summed unit-blind. */
  readonly quantity: string;
  /** `numeric(19,4)` money string over moving-average events; null when none. */
  readonly value: string | null;
}

/** The as-of window a stock-value drill-down shares (`RPT-002`). */
export interface StockValueRecordsQuery {
  readonly organizationId: string;
  readonly asOf: string;
  readonly locationIds?: readonly string[] | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** One `stock_movement` row behind the stock-value section. */
export interface StockValueRecordRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly movementType: string;
  readonly quantityDelta: string;
  readonly unitId: string;
  readonly valueDelta: string | null;
  readonly currency: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
}

/** The half-open cutoff window a stock-variance drill-down shares. */
export interface StockCountVarianceRecordsQuery {
  readonly organizationId: string;
  readonly from: string;
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** One approved `stock_count_line` behind the stock-variance section. */
export interface StockCountVarianceRecordRow {
  readonly id: string;
  readonly stockCountId: string;
  readonly cutoff: string;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  readonly expectedQty: string;
  readonly countedQty: string | null;
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly recount: boolean;
}

/** The half-open finish window a production drill-down shares. */
export interface ProductionYieldRecordsQuery {
  readonly organizationId: string;
  readonly from: string;
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** One completed `production_batch` behind the production section. */
export interface ProductionYieldRecordRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly recipeVersionId: string;
  readonly recipeName: string | null;
  readonly status: string;
  readonly actualStart: string | null;
  readonly actualFinish: string | null;
  readonly plannedOutputQty: string | null;
  readonly actualOutputQty: string | null;
  readonly yieldVariancePct: string | null;
}

/** The half-open `[from, to)` `occurred_at` window a waste drill-down shares. */
export interface WasteStageRecordsQuery {
  readonly organizationId: string;
  readonly from: string;
  readonly to: string;
  readonly locationIds?: readonly string[] | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** One `waste_event` behind the waste section. */
export interface WasteStageRecordRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly stage: string;
  readonly reasonCode: string;
  readonly itemId: string | null;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly productVariantId: string | null;
  readonly quantity: string;
  readonly unitId: string;
  readonly valueMethod: string;
  readonly value: string | null;
  readonly currency: string | null;
}

/** One drill-down page with a conservative completeness flag. */
export interface StockValueRecordPage {
  readonly rows: readonly StockValueRecordRow[];
  readonly truncated: boolean;
}
export interface StockCountVarianceRecordPage {
  readonly rows: readonly StockCountVarianceRecordRow[];
  readonly truncated: boolean;
}
export interface ProductionYieldRecordPage {
  readonly rows: readonly ProductionYieldRecordRow[];
  readonly truncated: boolean;
}
export interface WasteStageRecordPage {
  readonly rows: readonly WasteStageRecordRow[];
  readonly truncated: boolean;
}
