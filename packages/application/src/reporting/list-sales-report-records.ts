import {
  DomainError,
  isSalesReportGrain,
  netSalesFromLine,
  type SalesReportGrain,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import type { SalesReportScope } from "./build-sales-report";
import {
  DEFAULT_SALES_REPORT_RECORD_LIMIT,
  SALES_REPORT_CURRENCY,
  type ReportingStore,
  type SalesReportLineRow,
} from "./types";

/**
 * The RPT-002 drill-down: the sales lines behind a summary, each with its
 * resolved `netSales` (the domain `netSalesFromLine` source preference) and the
 * ledger `ingredientCost` it contributed. Same filters as `buildSalesReport`
 * plus `limit`/`offset`; `truncated` is conservative — `true` means more
 * in-scope rows may exist, never that exactly `limit` were returned.
 *
 * `option_kind = 'included'` lines are excluded (a revenue/margin view,
 * `SALE-011`); the exclusion is stated in `notes` so it is visible, not silent.
 * `grain` is validated and echoed for parity with the summary but does **not**
 * filter or bucket the drill-down (the window `from`/`to` do that).
 *
 * A read: no audit fact is written (`ADR-0007`).
 */

/** The drill-down caveat: the ledger cost basis. */
export const SALES_REPORT_DRILLDOWN_NOTE =
  "ingredient cost is the moving-average value posted to the stock ledger for each sales line; a line with no posted consumption shows 0";

/** The drill-down caveat: the `SALE-011` `included`-line omission is deliberate. */
export const SALES_REPORT_DRILLDOWN_INCLUDED_NOTE =
  "lines with option_kind='included' are retained for consumption but excluded from this revenue/margin view (SALE-011)";

export interface ListSalesReportRecordsInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly from: string;
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** One drill-down record: the line's stored fields plus resolved net sales. */
export interface SalesReportLineRecord extends Omit<SalesReportLineRow, "netAmount"> {
  /** The resolved net sales (source `net_amount`, else derived); never null. */
  readonly netSales: string;
}

export interface SalesReportRecords {
  readonly asOf: string;
  readonly scope: SalesReportScope;
  readonly period: { readonly from: string; readonly to: string };
  readonly grain: SalesReportGrain;
  readonly currency: typeof SALES_REPORT_CURRENCY;
  readonly records: readonly SalesReportLineRecord[];
  readonly truncated: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly notes: readonly string[];
}

/** Resolves the line's net sales via the domain source preference. */
function toRecord(row: SalesReportLineRow): SalesReportLineRecord {
  const { netAmount, ...rest } = row;
  // The domain treats a blank `net_amount` as absent while the SQL `coalesce`
  // only collapses NULL; a `numeric` column cannot store a blank, so the two
  // agree on stored data (the domain check guards direct callers).
  return {
    ...rest,
    netSales: netSalesFromLine({
      grossAmount: row.grossAmount,
      taxAmount: row.taxAmount,
      discountAmount: row.discountAmount,
      refundAmount: row.refundAmount,
      netAmount,
    }),
  };
}

/**
 * Lists the drill-down records. `from`/`to` are inclusive ISO instants with
 * `from <= to`; `limit` defaults to `DEFAULT_SALES_REPORT_RECORD_LIMIT` and is
 * clamped to a positive integer, `offset` to a non-negative one. A malformed
 * period or `grain` is a `DomainError` before the store is touched. (`grain` is
 * echoed only; the window bounds are what filter the rows.)
 */
export async function listSalesReportRecords(
  store: ReportingStore,
  input: ListSalesReportRecordsInput,
): Promise<SalesReportRecords> {
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

  const limit =
    input.limit === undefined || !Number.isInteger(input.limit) || input.limit < 1
      ? DEFAULT_SALES_REPORT_RECORD_LIMIT
      : input.limit;
  const offset =
    input.offset === undefined || !Number.isInteger(input.offset) || input.offset < 0
      ? 0
      : input.offset;

  const locationIds =
    input.locationIds === undefined || input.locationIds.length === 0
      ? null
      : [...input.locationIds];

  const page = await store.listSalesLineRecords({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    grain: input.grain,
    limit,
    offset,
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.productVariantId === undefined ? {} : { productVariantId: input.productVariantId }),
  });

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
    records: page.rows.map(toRecord),
    truncated: page.truncated,
    limit,
    offset,
    notes: [SALES_REPORT_DRILLDOWN_NOTE, SALES_REPORT_DRILLDOWN_INCLUDED_NOTE],
  };
}
