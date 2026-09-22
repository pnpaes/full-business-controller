import type {
  ReportingStore,
  SalesGroupRow,
  SalesLineQuery,
  SalesReportLineRow,
  SalesReportLineRowPage,
  SalesSummary,
  SalesSummaryQuery,
} from "./types";

/**
 * In-memory `ReportingStore` for the unit suite. It mirrors the Postgres adapter
 * where it can: organization scoping, the window and dimension filters, the
 * `SALE-011` `option_kind = 'included'` exclusion on the drill-down, and the
 * `occurred_at`-then-id ordering and paging; `reporting.postgres.test.ts` covers
 * the real adapter (the SQL group-by, the resolved-variant chain and the
 * window-level transaction count).
 *
 * Known divergences from the adapter, because the fake is seeded with
 * **pre-aggregated** group rows and pre-built line rows:
 * - `summarizeSales` cannot recompute the window-level distinct transaction
 *   count (F2), so it returns the sum of the seeded group `transactions`; and it
 *   cannot apply the `included` exclusion, because the seeded groups are already
 *   aggregated. The adapter computes the distinct count over raw lines; the
 *   Postgres tests pin that behaviour.
 * - `listSalesLineRecords` can apply the `included` exclusion because each
 *   seeded line carries its `optionKind`, so it does.
 *
 * There is no `withTransaction` seam: the read model has no caller that needs a
 * snapshot-bound multi-read, and the port is read-only.
 */
interface SeededGroup {
  readonly organizationId: string;
  readonly row: SalesGroupRow;
}

interface SeededLine {
  readonly organizationId: string;
  readonly row: SalesReportLineRow;
}

export class FakeReportingStore implements ReportingStore {
  readonly groups: SeededGroup[] = [];
  readonly lines: SeededLine[] = [];

  /** Seeds one pre-aggregated group row for `organizationId`. */
  seedGroup(organizationId: string, row: SalesGroupRow): void {
    this.groups.push({ organizationId, row });
  }

  /** Seeds one drill-down line for `organizationId`. */
  seedLine(organizationId: string, row: SalesReportLineRow): void {
    this.lines.push({ organizationId, row });
  }

  /** True when the row's dimension value passes the query's filters. */
  private matchesFilters(
    query: SalesSummaryQuery | SalesLineQuery,
    row: {
      readonly locationId: string | null;
      readonly channelId: string | null;
      readonly category: string | null;
      readonly productVariantId: string | null;
    },
  ): boolean {
    const { locationIds, channelId, category, productVariantId } = query;
    if (locationIds !== undefined && locationIds.length > 0) {
      if (row.locationId === null || !locationIds.includes(row.locationId)) return false;
    }
    if (channelId !== undefined && row.channelId !== channelId) return false;
    if (category !== undefined && row.category !== category) return false;
    if (productVariantId !== undefined && row.productVariantId !== productVariantId) return false;
    return true;
  }

  async summarizeSales(query: SalesSummaryQuery): Promise<SalesSummary> {
    const rows = this.groups
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => this.matchesFilters(query, entry.row))
      .map((entry) => entry.row);
    return {
      rows,
      // Divergence (documented above): pre-aggregated seeds cannot yield the
      // window-level distinct count, so this is the sum of the group counts.
      transactions: rows.reduce((sum, row) => sum + row.transactions, 0),
    };
  }

  async listSalesLineRecords(query: SalesLineQuery): Promise<SalesReportLineRowPage> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const rows = this.lines
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => entry.row.optionKind !== "included")
      .filter((entry) => this.matchesFilters(query, entry.row))
      .filter((entry) => {
        const at = Date.parse(entry.row.occurredAt);
        return at >= from && at <= to;
      })
      .map((entry) => entry.row)
      .sort((left, right) => {
        if (left.occurredAt !== right.occurredAt)
          return left.occurredAt < right.occurredAt ? -1 : 1;
        return left.id < right.id ? -1 : 1;
      });
    const page = rows.slice(query.offset, query.offset + query.limit);
    return { rows: page, truncated: rows.length > query.offset + query.limit };
  }
}
