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
}
