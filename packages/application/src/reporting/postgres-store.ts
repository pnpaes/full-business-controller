import { MONEY_SCALE, QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

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
import { SALES_REPORT_UNMAPPED_KEY, SALES_REPORT_UNMAPPED_LABEL } from "./types";

/** Normalises a money sum to the storage scale (a no-op for a 4 dp numeric). */
function money(value: string): string {
  return formatDecimal(parseDecimal(value, MONEY_SCALE), MONEY_SCALE);
}

/** Normalises a quantity sum to the storage scale (a no-op for a 6 dp numeric). */
function quantity(value: string): string {
  return formatDecimal(parseDecimal(value, QUANTITY_SCALE), QUANTITY_SCALE);
}

/**
 * Converts a count returned as text (the safe `::bigint`-equivalent cast that
 * avoids the `::int` overflow ceiling) to a number. A count beyond
 * `Number.MAX_SAFE_INTEGER` cannot be represented losslessly, so it is rejected
 * rather than silently rounded.
 */
function countValue(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`transaction count "${value}" is not a safe integer`);
  }
  return parsed;
}

/** The measures every group and total shares, normalized to their storage scale. */
function measures(row: repo.SalesGroupAggregate) {
  return {
    transactions: countValue(row.transactions),
    units: quantity(row.units),
    grossSales: money(row.grossSales),
    netSales: money(row.netSales),
    taxAmount: money(row.taxAmount),
    discountAmount: money(row.discountAmount),
    refundAmount: money(row.refundAmount),
    ingredientCost: money(row.ingredientCost),
  };
}

/**
 * Shapes a persistence aggregate into the port's group row, filling `key`/`label`
 * for the grouped dimension and leaving the other dimension fields null. A null
 * dimension value becomes the shared `unmapped` key so the report can caveat it;
 * a non-null id whose joined name is missing falls back to the **id**, never to
 * the `Unmapped` label (the id is a real, if unlabelled, value).
 */
function toGroupRow(
  groupBy: SalesSummaryQuery["groupBy"],
  row: repo.SalesGroupAggregate,
): SalesGroupRow {
  const base = { periodBucket: row.periodBucket, ...measures(row) };
  switch (groupBy) {
    case "location":
      return {
        ...base,
        key: row.locationId ?? SALES_REPORT_UNMAPPED_KEY,
        label:
          row.locationId === null
            ? SALES_REPORT_UNMAPPED_LABEL
            : (row.locationName ?? row.locationId),
        locationId: row.locationId,
        channelId: null,
        category: null,
        productVariantId: null,
        productKind: null,
        optionKinds: [],
      };
    case "channel":
      return {
        ...base,
        key: row.channelId ?? SALES_REPORT_UNMAPPED_KEY,
        label:
          row.channelId === null ? SALES_REPORT_UNMAPPED_LABEL : (row.channelName ?? row.channelId),
        locationId: null,
        channelId: row.channelId,
        category: null,
        productVariantId: null,
        productKind: null,
        optionKinds: [],
      };
    case "category":
      return {
        ...base,
        key: row.category ?? SALES_REPORT_UNMAPPED_KEY,
        label: row.category ?? SALES_REPORT_UNMAPPED_LABEL,
        locationId: null,
        channelId: null,
        category: row.category,
        productVariantId: null,
        productKind: null,
        optionKinds: [],
      };
    case "product":
      return {
        ...base,
        key: row.productVariantId ?? SALES_REPORT_UNMAPPED_KEY,
        label:
          row.productVariantId === null
            ? SALES_REPORT_UNMAPPED_LABEL
            : (row.productName ?? row.productVariantId),
        locationId: null,
        channelId: null,
        // category/productKind/optionKinds carry the resolved product's values
        // (DEC-109 item 5), so menu engineering needs no second read. The other
        // dimensions leave them empty.
        category: row.category,
        productVariantId: row.productVariantId,
        productKind: row.productKind,
        // `optionKinds` is present for every product group: the GROUP BY
        // guarantees at least one line, so `array_agg` is never null here. The
        // `?? []` is only the type-level guard for the shared nullable column
        // (unreachable in practice).
        optionKinds: row.optionKinds ?? [],
      };
    case "period":
      return {
        ...base,
        key: row.periodBucket,
        label: row.periodBucket,
        locationId: null,
        channelId: null,
        category: null,
        productVariantId: null,
        productKind: null,
        optionKinds: [],
      };
    default:
      throw new Error(`unknown sales report groupBy "${String(groupBy)}"`);
  }
}

/** Maps a persistence line row to the port's drill-down record. */
function toLineRecord(row: repo.SalesLineRow): SalesReportLineRow {
  return {
    id: row.id,
    salesTransactionId: row.salesTransactionId,
    occurredAt: row.occurredAt,
    locationId: row.locationId,
    channelId: row.channelId,
    category: row.category,
    productVariantId: row.productVariantId,
    sku: row.sku,
    externalProductRef: row.externalProductRef,
    externalLineId: row.externalLineId,
    optionKind: row.optionKind,
    quantity: quantity(row.quantity),
    grossAmount: row.grossAmount === null ? null : money(row.grossAmount),
    netAmount: row.netAmount === null ? null : money(row.netAmount),
    taxAmount: row.taxAmount === null ? null : money(row.taxAmount),
    discountAmount: row.discountAmount === null ? null : money(row.discountAmount),
    refundAmount: row.refundAmount === null ? null : money(row.refundAmount),
    ingredientCost: money(row.ingredientCost),
    reversalOfId: row.reversalOfId,
  };
}

/**
 * Adapts the persistence reporting repository to the `ReportingStore` port: the
 * `timestamptz` columns become ISO strings and the numeric sums are normalized
 * to their storage scale. Every read passes the organization through, so the
 * adapter cannot escape the `DEC-061` row scope.
 */
export function createPostgresReportingStore(db: Database): ReportingStore {
  return {
    summarizeSales: async (query: SalesSummaryQuery) => {
      const filters = {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        grain: query.grain,
      };
      const rows = await repo.summarizeSales(db, {
        ...filters,
        groupBy: query.groupBy,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
        ...(query.channelId === undefined ? {} : { channelId: query.channelId }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.productVariantId === undefined
          ? {}
          : { productVariantId: query.productVariantId }),
      });
      // Sequential, not `Promise.all`: both reads may run on one transaction
      // client, where concurrent statements on the same connection can collide.
      const transactions = await repo.countSalesTransactions(db, {
        ...filters,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
        ...(query.channelId === undefined ? {} : { channelId: query.channelId }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.productVariantId === undefined
          ? {}
          : { productVariantId: query.productVariantId }),
      });
      return {
        rows: rows.map((row) => toGroupRow(query.groupBy, row)),
        transactions: countValue(transactions),
      };
    },
    listSalesLineRecords: async (query: SalesLineQuery): Promise<SalesReportLineRowPage> => {
      const page = await repo.listSalesLineRecords(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        grain: query.grain,
        limit: query.limit,
        offset: query.offset,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
        ...(query.channelId === undefined ? {} : { channelId: query.channelId }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.productVariantId === undefined
          ? {}
          : { productVariantId: query.productVariantId }),
      });
      return { rows: page.rows.map(toLineRecord), truncated: page.truncated };
    },
    sumWasteByProductVariant: async (
      query: WasteByProductVariantQuery,
    ): Promise<readonly WasteByProductVariantRow[]> => {
      const rows = await repo.sumWasteByProductVariant(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return rows.map((row) => ({
        productVariantId: row.productVariantId,
        quantity: quantity(row.quantity),
        value: row.value === null ? null : money(row.value),
      }));
    },
    sumStockValueByLocationAsOf: async (
      query: StockValueByLocationQuery,
    ): Promise<readonly StockValueByLocationRow[]> => {
      const rows = await repo.sumStockValueByLocationAsOf(db, {
        organizationId: query.organizationId,
        asOf: new Date(query.asOf),
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return rows.map((row) => ({
        locationId: row.locationId,
        locationName: row.locationName,
        valueOnHand: money(row.valueOnHand),
      }));
    },
    sumStockCountVariance: async (
      query: StockCountVarianceQuery,
    ): Promise<readonly StockCountVarianceRow[]> => {
      const rows = await repo.sumStockCountVariance(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return rows.map((row) => ({
        locationId: row.locationId,
        locationName: row.locationName,
        counts: countValue(row.counts),
        varianceQty: quantity(row.varianceQty),
        adjustmentValue: money(row.adjustmentValue),
      }));
    },
    sumProductionYield: async (
      query: ProductionYieldQuery,
    ): Promise<readonly ProductionYieldRow[]> => {
      const rows = await repo.sumProductionYield(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return rows.map((row) => ({
        locationId: row.locationId,
        locationName: row.locationName,
        recipeVersionId: row.recipeVersionId,
        recipeName: row.recipeName,
        batches: countValue(row.batches),
        plannedOutput: quantity(row.plannedOutput),
        actualOutput: quantity(row.actualOutput),
        inputValue: money(row.inputValue),
        outputValue: money(row.outputValue),
      }));
    },
    sumWasteByStage: async (query: WasteByStageQuery): Promise<readonly WasteByStageRow[]> => {
      const rows = await repo.sumWasteByStage(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return rows.map((row) => ({
        stage: row.stage,
        events: countValue(row.events),
        quantity: quantity(row.quantity),
        value: row.value === null ? null : money(row.value),
      }));
    },
    listStockValueRecords: async (query: StockValueRecordsQuery): Promise<StockValueRecordPage> => {
      const page = await repo.listStockValueRecords(db, {
        organizationId: query.organizationId,
        asOf: new Date(query.asOf),
        limit: query.limit,
        offset: query.offset,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return {
        rows: page.rows.map((row): StockValueRecordRow => ({
          ...row,
          quantityDelta: quantity(row.quantityDelta),
          valueDelta: row.valueDelta === null ? null : money(row.valueDelta),
        })),
        truncated: page.truncated,
      };
    },
    listStockCountVarianceRecords: async (
      query: StockCountVarianceRecordsQuery,
    ): Promise<StockCountVarianceRecordPage> => {
      const page = await repo.listStockCountVarianceRecords(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return {
        rows: page.rows.map((row): StockCountVarianceRecordRow => ({
          ...row,
          expectedQty: quantity(row.expectedQty),
          countedQty: row.countedQty === null ? null : quantity(row.countedQty),
          varianceQty: row.varianceQty === null ? null : quantity(row.varianceQty),
        })),
        truncated: page.truncated,
      };
    },
    listProductionYieldRecords: async (
      query: ProductionYieldRecordsQuery,
    ): Promise<ProductionYieldRecordPage> => {
      const page = await repo.listProductionYieldRecords(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return {
        rows: page.rows.map((row): ProductionYieldRecordRow => ({
          ...row,
          plannedOutputQty: row.plannedOutputQty === null ? null : quantity(row.plannedOutputQty),
          actualOutputQty: row.actualOutputQty === null ? null : quantity(row.actualOutputQty),
        })),
        truncated: page.truncated,
      };
    },
    listWasteStageRecords: async (query: WasteStageRecordsQuery): Promise<WasteStageRecordPage> => {
      const page = await repo.listWasteStageRecords(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
        ...(query.locationIds === undefined ? {} : { locationIds: query.locationIds }),
      });
      return {
        rows: page.rows.map((row): WasteStageRecordRow => ({
          ...row,
          quantity: quantity(row.quantity),
          value: row.value === null ? null : money(row.value),
        })),
        truncated: page.truncated,
      };
    },
  };
}
