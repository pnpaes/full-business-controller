import { MONEY_SCALE, QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import type {
  ProductionYieldQuery,
  ProductionYieldRecordPage,
  ProductionYieldRecordRow,
  ProductionYieldRecordsQuery,
  ProductionYieldRow,
  ReportingStore,
  SalesGroupRow,
  SalesLineQuery,
  SalesReportLineRow,
  SalesReportLineRowPage,
  SalesSummary,
  SalesSummaryQuery,
  StockCountVarianceQuery,
  StockCountVarianceRecordPage,
  StockCountVarianceRecordRow,
  StockCountVarianceRecordsQuery,
  StockCountVarianceRow,
  StockValueByLocationQuery,
  StockValueByLocationRow,
  StockValueRecordPage,
  StockValueRecordRow,
  StockValueRecordsQuery,
  WasteByProductVariantQuery,
  WasteByProductVariantRow,
  WasteByStageQuery,
  WasteByStageRow,
  WasteStageRecordPage,
  WasteStageRecordRow,
  WasteStageRecordsQuery,
} from "./types";

/**
 * In-memory `ReportingStore` for the unit suite. It mirrors the Postgres adapter
 * where it can: organization scoping, the window and dimension filters, the
 * `SALE-011` `option_kind = 'included'` exclusion on the drill-down, the
 * `occurred_at`-then-id ordering and paging, and — for a `product` group — the
 * adapter's ordering (product name, then resolved variant id, with a null
 * variant last) and its sorted distinct `optionKinds`;
 * `reporting.postgres.test.ts` covers the real adapter (the SQL group-by, the
 * resolved-variant chain and the window-level transaction count).
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

interface SeededWaste {
  readonly organizationId: string;
  readonly locationId: string;
  readonly occurredAt: string;
  readonly row: WasteByProductVariantRow;
}

/*
 * RPT-004 operational-reporting seeds (`DEC-110`). As with the sales seeds, the
 * aggregate sections are seeded **pre-aggregated** and the drill records are
 * seeded raw with their own window key. The fake filters the aggregates by
 * organization **and location scope** only — it cannot apply the half-open
 * window to a pre-aggregated row, so the window rule is not exercised here; the
 * raw drill records do carry their own window key and are filtered by the
 * half-open `[from, to)` window. The fake never re-derives an aggregate from raw
 * records (`operations-report.postgres.test.ts` covers the real SQL).
 */
interface SeededStockValue {
  readonly organizationId: string;
  readonly row: StockValueByLocationRow;
}

interface SeededStockVariance {
  readonly organizationId: string;
  readonly row: StockCountVarianceRow;
}

interface SeededProductionYield {
  readonly organizationId: string;
  readonly row: ProductionYieldRow;
}

interface SeededWasteStage {
  readonly organizationId: string;
  readonly locationId: string;
  readonly row: WasteByStageRow;
}

interface SeededStockValueRecord {
  readonly organizationId: string;
  readonly asOf: string;
  readonly row: StockValueRecordRow;
}

interface SeededStockVarianceRecord {
  readonly organizationId: string;
  readonly cutoff: string;
  readonly row: StockCountVarianceRecordRow;
}

interface SeededProductionRecord {
  readonly organizationId: string;
  readonly actualFinish: string;
  readonly row: ProductionYieldRecordRow;
}

interface SeededWasteStageRecord {
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly row: WasteStageRecordRow;
}

/** True when a location-scoped row passes an empty/undefined scope. */
function inLocationScope(locationIds: readonly string[] | undefined, locationId: string): boolean {
  return locationIds === undefined || locationIds.length === 0 || locationIds.includes(locationId);
}

/** Pages a sorted record list with the adapter's conservative truncation flag. */
function pageRecords<T>(
  rows: readonly T[],
  limit: number,
  offset: number,
): {
  readonly rows: readonly T[];
  readonly truncated: boolean;
} {
  return { rows: rows.slice(offset, offset + limit), truncated: rows.length > offset + limit };
}

/**
 * The adapter's `product`-group ordering: `order by product_variant.name,
 * resolvedVariantId` — a null resolved variant (the unmapped bucket) sorts last,
 * as Postgres orders a null ASC key. Mirrored so the fake and Postgres agree.
 */
function compareProductRows(left: SalesGroupRow, right: SalesGroupRow): number {
  const leftUnmapped = left.productVariantId === null ? 1 : 0;
  const rightUnmapped = right.productVariantId === null ? 1 : 0;
  if (leftUnmapped !== rightUnmapped) return leftUnmapped - rightUnmapped;
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  const leftId = left.productVariantId ?? "";
  const rightId = right.productVariantId ?? "";
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/** Sums money/quantity strings in the fake's waste read, mirroring the adapter. */
function sumDecimals(values: readonly string[], scale: number): string | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0n;
  for (const value of values) {
    total += parseDecimal(value, scale);
  }
  return formatDecimal(total, scale);
}

export class FakeReportingStore implements ReportingStore {
  readonly groups: SeededGroup[] = [];
  readonly lines: SeededLine[] = [];
  readonly waste: SeededWaste[] = [];
  readonly stockValues: SeededStockValue[] = [];
  readonly stockVariances: SeededStockVariance[] = [];
  readonly productionYields: SeededProductionYield[] = [];
  readonly wasteStages: SeededWasteStage[] = [];
  readonly stockValueRecords: SeededStockValueRecord[] = [];
  readonly stockVarianceRecords: SeededStockVarianceRecord[] = [];
  readonly productionRecords: SeededProductionRecord[] = [];
  readonly wasteStageRecords: SeededWasteStageRecord[] = [];

  /** Seeds one pre-aggregated group row for `organizationId`. */
  seedGroup(organizationId: string, row: SalesGroupRow): void {
    this.groups.push({ organizationId, row });
  }

  /** Seeds one drill-down line for `organizationId`. */
  seedLine(organizationId: string, row: SalesReportLineRow): void {
    this.lines.push({ organizationId, row });
  }

  /** Seeds one waste row for a variant, at a location and instant. */
  seedWaste(
    organizationId: string,
    locationId: string,
    occurredAt: string,
    row: WasteByProductVariantRow,
  ): void {
    this.waste.push({ organizationId, locationId, occurredAt, row });
  }

  /** Seeds one pre-aggregated stock-value row (`DEC-110` item 1). */
  seedStockValue(organizationId: string, row: StockValueByLocationRow): void {
    this.stockValues.push({ organizationId, row });
  }

  /** Seeds one pre-aggregated stock-count variance row (`DEC-110` items 2/3). */
  seedStockVariance(organizationId: string, row: StockCountVarianceRow): void {
    this.stockVariances.push({ organizationId, row });
  }

  /** Seeds one pre-aggregated production-yield row (`DEC-110` item 5). */
  seedProductionYield(organizationId: string, row: ProductionYieldRow): void {
    this.productionYields.push({ organizationId, row });
  }

  /** Seeds one pre-aggregated waste-by-stage row at a location (`DEC-110` item 4). */
  seedWasteStage(organizationId: string, locationId: string, row: WasteByStageRow): void {
    this.wasteStages.push({ organizationId, locationId, row });
  }

  /** Seeds one stock-value drill record, anchored at its as-of instant. */
  seedStockValueRecord(organizationId: string, asOf: string, row: StockValueRecordRow): void {
    this.stockValueRecords.push({ organizationId, asOf, row });
  }

  /** Seeds one stock-variance drill record, anchored at its count cutoff. */
  seedStockCountVarianceRecord(
    organizationId: string,
    cutoff: string,
    row: StockCountVarianceRecordRow,
  ): void {
    this.stockVarianceRecords.push({ organizationId, cutoff, row });
  }

  /** Seeds one production drill record, anchored at its actual finish. */
  seedProductionYieldRecord(
    organizationId: string,
    actualFinish: string,
    row: ProductionYieldRecordRow,
  ): void {
    this.productionRecords.push({ organizationId, actualFinish, row });
  }

  /** Seeds one waste drill record, anchored at its occurrence. */
  seedWasteStageRecord(organizationId: string, occurredAt: string, row: WasteStageRecordRow): void {
    this.wasteStageRecords.push({ organizationId, occurredAt, row });
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
    const ordered = query.groupBy === "product" ? [...rows].sort(compareProductRows) : rows;
    return {
      rows: ordered.map((row) => ({ ...row, optionKinds: [...row.optionKinds].sort() })),
      // Divergence (documented above): pre-aggregated seeds cannot yield the
      // window-level distinct count, so this is the sum of the group counts.
      transactions: ordered.reduce((sum, row) => sum + row.transactions, 0),
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

  async sumWasteByProductVariant(
    query: WasteByProductVariantQuery,
  ): Promise<readonly WasteByProductVariantRow[]> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const inScope = this.waste
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter(
        (entry) =>
          query.locationIds === undefined ||
          query.locationIds.length === 0 ||
          query.locationIds.includes(entry.locationId),
      )
      .filter((entry) => {
        const at = Date.parse(entry.occurredAt);
        return at >= from && at <= to;
      });
    const byVariant = new Map<string, SeededWaste[]>();
    for (const entry of inScope) {
      const list = byVariant.get(entry.row.productVariantId) ?? [];
      list.push(entry);
      byVariant.set(entry.row.productVariantId, list);
    }
    return [...byVariant.entries()]
      .map(([productVariantId, entries]) => {
        const valued = entries
          .map((entry) => entry.row.value)
          .filter((value): value is string => value !== null);
        return {
          productVariantId,
          quantity: sumDecimals(
            entries.map((entry) => entry.row.quantity),
            QUANTITY_SCALE,
          )!,
          value: sumDecimals(valued, MONEY_SCALE),
        };
      })
      .sort((left, right) => (left.productVariantId < right.productVariantId ? -1 : 1));
  }

  async sumStockValueByLocationAsOf(
    query: StockValueByLocationQuery,
  ): Promise<readonly StockValueByLocationRow[]> {
    // Divergence: the aggregate is seeded pre-summed, so the fake cannot
    // recompute the as-of window; it filters by organization and location only.
    return this.stockValues
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .map((entry) => entry.row)
      .sort((left, right) => (left.locationId < right.locationId ? -1 : 1));
  }

  async sumStockCountVariance(
    query: StockCountVarianceQuery,
  ): Promise<readonly StockCountVarianceRow[]> {
    return this.stockVariances
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .map((entry) => entry.row)
      .sort((left, right) => (left.locationId < right.locationId ? -1 : 1));
  }

  async sumProductionYield(query: ProductionYieldQuery): Promise<readonly ProductionYieldRow[]> {
    return this.productionYields
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .map((entry) => entry.row)
      .sort((left, right) => (left.recipeVersionId < right.recipeVersionId ? -1 : 1));
  }

  async sumWasteByStage(query: WasteByStageQuery): Promise<readonly WasteByStageRow[]> {
    // Divergence: the row is seeded pre-aggregated per stage, so the fake
    // cannot apply the half-open window here; it filters by organization and
    // location scope only (the Postgres tests pin the window).
    return this.wasteStages
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.locationId))
      .map((entry) => entry.row)
      .sort((left, right) => (left.stage < right.stage ? -1 : 1));
  }

  async listStockValueRecords(query: StockValueRecordsQuery): Promise<StockValueRecordPage> {
    // Divergence: the adapter orders `occurred_at, posted_at, id`; a seeded row
    // carries no `posted_at`, so the fake breaks ties on `id` alone.
    const asOf = Date.parse(query.asOf);
    const rows = this.stockValueRecords
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => Date.parse(entry.asOf) <= asOf)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .map((entry) => entry.row)
      .sort((left, right) => {
        if (left.occurredAt !== right.occurredAt)
          return left.occurredAt < right.occurredAt ? -1 : 1;
        return left.id < right.id ? -1 : 1;
      });
    return pageRecords(rows, query.limit, query.offset);
  }

  async listStockCountVarianceRecords(
    query: StockCountVarianceRecordsQuery,
  ): Promise<StockCountVarianceRecordPage> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const rows = this.stockVarianceRecords
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .filter((entry) => {
        const cutoff = Date.parse(entry.cutoff);
        return cutoff >= from && cutoff < to;
      })
      .map((entry) => entry.row)
      .sort((left, right) => {
        if (left.cutoff !== right.cutoff) return left.cutoff < right.cutoff ? 1 : -1;
        return left.id < right.id ? -1 : 1;
      });
    return pageRecords(rows, query.limit, query.offset);
  }

  async listProductionYieldRecords(
    query: ProductionYieldRecordsQuery,
  ): Promise<ProductionYieldRecordPage> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const rows = this.productionRecords
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .filter((entry) => {
        const finish = Date.parse(entry.actualFinish);
        return finish >= from && finish < to;
      })
      .map((entry) => entry.row)
      .sort((left, right) => {
        const leftFinish = left.actualFinish ?? "";
        const rightFinish = right.actualFinish ?? "";
        if (leftFinish !== rightFinish) return leftFinish < rightFinish ? 1 : -1;
        return left.id < right.id ? -1 : 1;
      });
    return pageRecords(rows, query.limit, query.offset);
  }

  async listWasteStageRecords(query: WasteStageRecordsQuery): Promise<WasteStageRecordPage> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const rows = this.wasteStageRecords
      .filter((entry) => entry.organizationId === query.organizationId)
      .filter((entry) => inLocationScope(query.locationIds, entry.row.locationId))
      .filter((entry) => {
        const at = Date.parse(entry.occurredAt);
        return at >= from && at < to;
      })
      .map((entry) => entry.row)
      .sort((left, right) => {
        if (left.occurredAt !== right.occurredAt)
          return left.occurredAt < right.occurredAt ? 1 : -1;
        return left.id < right.id ? 1 : -1;
      });
    return pageRecords(rows, query.limit, query.offset);
  }
}
