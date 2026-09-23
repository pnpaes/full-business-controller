import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  isSalesReportGrain,
  parseDecimal,
  yieldRatio,
  yieldVariancePctFromTotals,
  type SalesReportGrain,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import {
  DEFAULT_OPERATIONS_REPORT_RECORD_LIMIT,
  OPERATIONS_REPORT_MAX_ROWS,
  SALES_REPORT_CURRENCY,
  isOperationsReportSection,
  type OperationsReportSection,
  type ProductionYieldRecordRow,
  type ReportingStore,
  type StockCountVarianceRecordRow,
  type StockValueRecordRow,
  type WasteStageRecordRow,
} from "./types";

/**
 * The operational report (`RPT-004`, rows 13e/13f, `DEC-110`): stock
 * value/variance, production yield and waste value/reasons, over the same
 * on-demand, org-scoped read model as the sales report (`ADR-0007`) — no
 * aggregate table, no audit fact.
 *
 * The frozen definitions (`DEC-110`) are:
 * - **Stock value** is point-in-time Σ `value_delta` ≤ `asOf` by location (the
 *   ledger, not the `stock_balance` projection); the section echoes its own
 *   `asOf` and is deliberately **not** period-bounded.
 * - **Stock variance quantity** is `counted − expected` as stored; the variance
 *   **value is the booked count adjustment** (the ledger truth), never
 *   `variance_qty × unit cost`.
 * - **Production yield** reports both figures over the batch totals — the
 *   stored-yield fraction `(actual − planned) / planned` and the ratio
 *   `actual / planned` — for completed batches.
 * - **Waste** is grouped by the `DEC-018` `stage` axis (free-text `reason_code`
 *   is not the axis); the value is `moving_average`-only (`DEC-068`), item-only
 *   events are included, and the quantity sum is unit-blind.
 *
 * Every section is capped at `OPERATIONS_REPORT_MAX_ROWS`; `truncated` is true
 * when any section was capped, and the `notes` say so.
 *
 * Flow windows are half-open `[from, to)` for **every** section (`DEC-110` item
 * 6): variance (by `stock_count.cutoff`), production (by
 * `production_batch.actual_finish`) and waste (by `waste_event.occurred_at`).
 * Stock value is the one point-in-time read (`<= asOf`), deliberately not
 * period-bounded.
 */

/** The caveat: stock value is an as-of ledger balance, not period-bounded. */
export const OPERATIONS_REPORT_STOCK_VALUE_NOTE =
  "stock value is a point-in-time ledger balance as of the report's as-of instant, not bounded by the report period";

/** The caveat: the variance value is the booked adjustment, not qty × cost. */
export const OPERATIONS_REPORT_VARIANCE_NOTE =
  "stock variance value is the booked count-adjustment posted to the stock ledger, not variance_qty × unit cost";

/** The caveat: the yield definition, both figures. */
export const OPERATIONS_REPORT_PRODUCTION_YIELD_NOTE =
  "production yield is computed from completed batches' planned/actual output totals: yield variance is (actual − planned) / planned and the ratio is actual / planned, both null when planned output is non-positive";

/** The caveat: the waste reasons axis is the DEC-018 stage. */
export const OPERATIONS_REPORT_WASTE_STAGE_NOTE =
  "waste reasons use the DEC-018 stage axis (the closed nine-stage vocabulary); the free-text reason_code is not the axis";

/** The caveat: the waste value basis and the unit-blind quantity. */
export const OPERATIONS_REPORT_WASTE_VALUE_NOTE =
  "waste value is moving-average only (DEC-068) and the quantity sum is unit-blind; item-only events (no product variant) are included";

/** The caveat raised when one or more sections hit `OPERATIONS_REPORT_MAX_ROWS`. */
export const OPERATIONS_REPORT_TRUNCATED_NOTE =
  "one or more sections were capped; the section totals still cover every in-scope row";

/** The stock-value drill-down caveat. */
export const OPERATIONS_REPORT_STOCK_VALUE_DRILLDOWN_NOTE =
  "records are the stock movements at or before the as-of instant, in ledger order";

/** The stock-variance drill-down caveat. */
export const OPERATIONS_REPORT_VARIANCE_DRILLDOWN_NOTE =
  "records are the approved stock-count lines in the window; the value of a count's adjustment is on the ledger, not on the line";

/** The production drill-down caveat. */
export const OPERATIONS_REPORT_PRODUCTION_DRILLDOWN_NOTE =
  "records are the completed batches in the window; yield_variance_pct is the stored per-batch fact and the group figures are derived from the totals";

/** The waste drill-down caveat. */
export const OPERATIONS_REPORT_WASTE_DRILLDOWN_NOTE =
  "records are the waste events in the window, grouped by the DEC-018 stage; value is moving-average only (DEC-068) and item-only events are included";

export interface BuildOperationsReportInput {
  readonly organizationId: string;
  /** Inclusive lower bound on the half-open flow windows; an ISO instant. */
  readonly from: string;
  /** Exclusive upper bound on the half-open flow windows; an ISO instant. */
  readonly to: string;
  readonly grain: SalesReportGrain;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
  /** The stock-value valuation instant; defaults to now. An ISO instant. */
  readonly asOf?: string | undefined;
}

/** The echoed filters an operational report was produced with (`FND-006`). */
export interface OperationsReportScope {
  /** `null` = organization-wide. */
  readonly locationIds: readonly string[] | null;
}

/** One stock-value row: a location's as-of ledger value. */
export interface StockValueReportRow {
  readonly locationId: string;
  readonly locationName: string | null;
  readonly valueOnHand: string;
}

/** The stock-value section: rows by location plus the organization total. */
export interface StockValueSection {
  /** The valuation instant echoed (`FND-006`); as-of, not period-bounded. */
  readonly asOf: string;
  readonly rows: readonly StockValueReportRow[];
  readonly total: { readonly valueOnHand: string };
}

/** One stock-variance row: a location's counts, variance quantity and booked value. */
export interface StockVarianceReportRow {
  readonly locationId: string;
  readonly locationName: string | null;
  readonly counts: number;
  readonly varianceQty: string;
  readonly adjustmentValue: string;
}

export interface StockVarianceSection {
  readonly rows: readonly StockVarianceReportRow[];
  readonly totals: {
    readonly counts: number;
    readonly varianceQty: string;
    readonly adjustmentValue: string;
  };
}

/** One production-yield row: a location/recipe version's batch totals and yield. */
export interface ProductionReportRow {
  readonly locationId: string;
  readonly locationName: string | null;
  readonly recipeVersionId: string;
  readonly recipeName: string | null;
  readonly batches: number;
  readonly plannedOutput: string;
  readonly actualOutput: string;
  /** `null` when planned output is non-positive. */
  readonly yieldVariancePct: string | null;
  /** `null` when planned output is non-positive. */
  readonly yieldRatio: string | null;
  readonly inputValue: string;
  readonly outputValue: string;
}

export interface ProductionSection {
  readonly rows: readonly ProductionReportRow[];
  readonly totals: {
    readonly batches: number;
    readonly plannedOutput: string;
    readonly actualOutput: string;
    readonly yieldVariancePct: string | null;
    readonly yieldRatio: string | null;
    readonly inputValue: string;
    readonly outputValue: string;
  };
}

/** One waste row: a `DEC-018` stage's events, unit-blind quantity and value. */
export interface WasteReportRow {
  readonly stage: string;
  readonly events: number;
  readonly quantity: string;
  /** `null` when no moving-average event in the stage carried a value. */
  readonly value: string | null;
}

export interface WasteSection {
  readonly rows: readonly WasteReportRow[];
  readonly totals: {
    readonly events: number;
    readonly quantity: string;
    readonly value: string | null;
  };
}

export interface OperationsReport {
  /** When the report was assembled; ISO. */
  readonly asOf: string;
  readonly scope: OperationsReportScope;
  readonly period: { readonly from: string; readonly to: string };
  readonly grain: SalesReportGrain;
  readonly currency: typeof SALES_REPORT_CURRENCY;
  readonly stockValue: StockValueSection;
  readonly stockVariance: StockVarianceSection;
  readonly production: ProductionSection;
  readonly waste: WasteSection;
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

/** Sums the non-null money strings, or `null` when none carried a value. */
function sumNullableMoney(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : sumMoney(present);
}

/** Sums a count column returned as a number. */
function sumCounts(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Normalises the location scope: empty/undefined reads as organization-wide. */
function normalizeLocationIds(
  locationIds: readonly string[] | undefined,
): readonly string[] | null {
  return locationIds === undefined || locationIds.length === 0 ? null : [...locationIds];
}

/**
 * Builds the operational report. `from`/`to` must be ISO instants with
 * `from <= to` (the flow windows are half-open `[from, to)`) and `grain` a
 * known value; `asOf`, when given, must be an ISO instant. Anything else is a
 * `DomainError` before the store is touched. An empty `locationIds` reads as
 * organization-wide, never "scoped to nothing".
 */
export async function buildOperationsReport(
  store: ReportingStore,
  input: BuildOperationsReportInput,
): Promise<OperationsReport> {
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
  if (input.asOf !== undefined) {
    assertIsoInstant(input.asOf, "asOf");
  }

  const locationIds = normalizeLocationIds(input.locationIds);
  const asOfInstant = input.asOf ?? new Date().toISOString();
  const scope: OperationsReportScope = { locationIds };

  // Sequential, not `Promise.all`: the reads may share one transaction client,
  // where concurrent statements on the same connection can collide.
  const stockValueRows = await store.sumStockValueByLocationAsOf({
    organizationId: input.organizationId,
    asOf: asOfInstant,
    ...(locationIds === null ? {} : { locationIds }),
  });
  const stockValueAll: StockValueReportRow[] = stockValueRows.map((row) => ({
    locationId: row.locationId,
    locationName: row.locationName,
    valueOnHand: row.valueOnHand,
  }));

  const varianceRows = await store.sumStockCountVariance({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    ...(locationIds === null ? {} : { locationIds }),
  });
  const varianceAll: StockVarianceReportRow[] = varianceRows.map((row) => ({
    locationId: row.locationId,
    locationName: row.locationName,
    counts: row.counts,
    varianceQty: row.varianceQty,
    adjustmentValue: row.adjustmentValue,
  }));

  const productionRows = await store.sumProductionYield({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    ...(locationIds === null ? {} : { locationIds }),
  });
  const productionAll: ProductionReportRow[] = productionRows.map((row) => ({
    locationId: row.locationId,
    locationName: row.locationName,
    recipeVersionId: row.recipeVersionId,
    recipeName: row.recipeName,
    batches: row.batches,
    plannedOutput: row.plannedOutput,
    actualOutput: row.actualOutput,
    yieldVariancePct: yieldVariancePctFromTotals(row.plannedOutput, row.actualOutput),
    yieldRatio: yieldRatio(row.plannedOutput, row.actualOutput),
    inputValue: row.inputValue,
    outputValue: row.outputValue,
  }));

  const wasteRows = await store.sumWasteByStage({
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    ...(locationIds === null ? {} : { locationIds }),
  });
  const wasteAll: WasteReportRow[] = wasteRows.map((row) => ({
    stage: row.stage,
    events: row.events,
    quantity: row.quantity,
    value: row.value,
  }));

  // Cap each section after the full set is read, so the totals still cover every
  // row (the sales-report precedent).
  const stockValueTruncated = stockValueAll.length > OPERATIONS_REPORT_MAX_ROWS;
  const varianceTruncated = varianceAll.length > OPERATIONS_REPORT_MAX_ROWS;
  const productionTruncated = productionAll.length > OPERATIONS_REPORT_MAX_ROWS;
  const wasteTruncated = wasteAll.length > OPERATIONS_REPORT_MAX_ROWS;
  const truncated =
    stockValueTruncated || varianceTruncated || productionTruncated || wasteTruncated;

  const productionPlanned = sumQuantity(productionAll.map((row) => row.plannedOutput));
  const productionActual = sumQuantity(productionAll.map((row) => row.actualOutput));

  const notes: string[] = [
    OPERATIONS_REPORT_STOCK_VALUE_NOTE,
    OPERATIONS_REPORT_VARIANCE_NOTE,
    OPERATIONS_REPORT_PRODUCTION_YIELD_NOTE,
    OPERATIONS_REPORT_WASTE_STAGE_NOTE,
    OPERATIONS_REPORT_WASTE_VALUE_NOTE,
  ];
  if (truncated) {
    notes.push(OPERATIONS_REPORT_TRUNCATED_NOTE);
  }

  return {
    asOf: new Date().toISOString(),
    scope,
    period: { from: input.from, to: input.to },
    grain: input.grain,
    currency: SALES_REPORT_CURRENCY,
    stockValue: {
      asOf: asOfInstant,
      rows: stockValueTruncated
        ? stockValueAll.slice(0, OPERATIONS_REPORT_MAX_ROWS)
        : stockValueAll,
      total: { valueOnHand: sumMoney(stockValueAll.map((row) => row.valueOnHand)) },
    },
    stockVariance: {
      rows: varianceTruncated ? varianceAll.slice(0, OPERATIONS_REPORT_MAX_ROWS) : varianceAll,
      totals: {
        counts: sumCounts(varianceAll.map((row) => row.counts)),
        varianceQty: sumQuantity(varianceAll.map((row) => row.varianceQty)),
        adjustmentValue: sumMoney(varianceAll.map((row) => row.adjustmentValue)),
      },
    },
    production: {
      rows: productionTruncated
        ? productionAll.slice(0, OPERATIONS_REPORT_MAX_ROWS)
        : productionAll,
      totals: {
        batches: sumCounts(productionAll.map((row) => row.batches)),
        plannedOutput: productionPlanned,
        actualOutput: productionActual,
        yieldVariancePct: yieldVariancePctFromTotals(productionPlanned, productionActual),
        yieldRatio: yieldRatio(productionPlanned, productionActual),
        inputValue: sumMoney(productionAll.map((row) => row.inputValue)),
        outputValue: sumMoney(productionAll.map((row) => row.outputValue)),
      },
    },
    waste: {
      rows: wasteTruncated ? wasteAll.slice(0, OPERATIONS_REPORT_MAX_ROWS) : wasteAll,
      totals: {
        events: sumCounts(wasteAll.map((row) => row.events)),
        quantity: sumQuantity(wasteAll.map((row) => row.quantity)),
        value: sumNullableMoney(wasteAll.map((row) => row.value)),
      },
    },
    truncated,
    notes,
  };
}

/*
 * The RPT-002 operational drill-down (`DEC-108` item 7): the underlying records
 * behind one section, each tagged with its section so a consumer can switch on
 * it. Bounded by a conservative `limit`/`offset`; org- and location-scoped. A
 * read: no audit fact (`ADR-0007`).
 */

/** One drill-down record, tagged with the section it belongs to. */
export type OperationsReportRecord =
  | ({ readonly section: "stock_value" } & StockValueRecordRow)
  | ({ readonly section: "stock_variance" } & StockCountVarianceRecordRow)
  | ({ readonly section: "production" } & ProductionYieldRecordRow)
  | ({ readonly section: "waste" } & WasteStageRecordRow);

export interface ListOperationsReportRecordsInput {
  readonly organizationId: string;
  readonly section: OperationsReportSection;
  readonly from: string;
  readonly to: string;
  readonly grain: SalesReportGrain;
  readonly locationIds?: readonly string[] | undefined;
  /** The stock-value valuation instant; defaults to now. An ISO instant. */
  readonly asOf?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface OperationsReportRecords {
  readonly asOf: string;
  readonly scope: OperationsReportScope;
  readonly period: { readonly from: string; readonly to: string };
  readonly grain: SalesReportGrain;
  readonly currency: typeof SALES_REPORT_CURRENCY;
  readonly section: OperationsReportSection;
  readonly records: readonly OperationsReportRecord[];
  readonly truncated: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly notes: readonly string[];
}

/** The section-specific caveat carried on a drill-down response. */
function drilldownNote(section: OperationsReportSection): string {
  switch (section) {
    case "stock_value":
      return OPERATIONS_REPORT_STOCK_VALUE_DRILLDOWN_NOTE;
    case "stock_variance":
      return OPERATIONS_REPORT_VARIANCE_DRILLDOWN_NOTE;
    case "production":
      return OPERATIONS_REPORT_PRODUCTION_DRILLDOWN_NOTE;
    case "waste":
      return OPERATIONS_REPORT_WASTE_DRILLDOWN_NOTE;
    default:
      throw new Error(`unknown operations report section "${String(section)}"`);
  }
}

/**
 * Lists the records behind one operational section. `from`/`to` are ISO instants
 * with `from <= to`; the flow sections (variance, production, waste) use the
 * half-open `[from, to)` window (`DEC-110` item 6) and stock value is
 * point-in-time `<= asOf`, so for stock value the window is the as-of instant
 * (not `from`/`to`), which the `notes` state. `limit` defaults to
 * `DEFAULT_OPERATIONS_REPORT_RECORD_LIMIT` and is clamped to a positive integer,
 * `offset` to a non-negative one. An unknown section, malformed period or
 * malformed `asOf` is a `DomainError` before the store is touched. A omitted
 * `asOf` defaults to the current instant.
 */
export async function listOperationsReportRecords(
  store: ReportingStore,
  input: ListOperationsReportRecordsInput,
): Promise<OperationsReportRecords> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (!isOperationsReportSection(input.section)) {
    throw new DomainError(`unknown operations report section "${String(input.section)}"`);
  }
  assertIsoInstant(input.from, "from");
  assertIsoInstant(input.to, "to");
  if (Date.parse(input.from) > Date.parse(input.to)) {
    throw new DomainError("from must be on or before to");
  }
  if (!isSalesReportGrain(input.grain)) {
    throw new DomainError(`unknown sales report grain "${String(input.grain)}"`);
  }
  if (input.asOf !== undefined) {
    assertIsoInstant(input.asOf, "asOf");
  }

  const limit =
    input.limit === undefined || !Number.isInteger(input.limit) || input.limit < 1
      ? DEFAULT_OPERATIONS_REPORT_RECORD_LIMIT
      : input.limit;
  const offset =
    input.offset === undefined || !Number.isInteger(input.offset) || input.offset < 0
      ? 0
      : input.offset;

  const locationIds = normalizeLocationIds(input.locationIds);
  const scope: OperationsReportScope = { locationIds };
  const asOfInstant = input.asOf ?? new Date().toISOString();
  const locationFilter = locationIds === null ? {} : { locationIds };

  let records: readonly OperationsReportRecord[];
  let truncated: boolean;
  switch (input.section) {
    case "stock_value": {
      const page = await store.listStockValueRecords({
        organizationId: input.organizationId,
        asOf: asOfInstant,
        limit,
        offset,
        ...locationFilter,
      });
      records = page.rows.map((row) => ({ section: "stock_value", ...row }));
      truncated = page.truncated;
      break;
    }
    case "stock_variance": {
      const page = await store.listStockCountVarianceRecords({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        limit,
        offset,
        ...locationFilter,
      });
      records = page.rows.map((row) => ({ section: "stock_variance", ...row }));
      truncated = page.truncated;
      break;
    }
    case "production": {
      const page = await store.listProductionYieldRecords({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        limit,
        offset,
        ...locationFilter,
      });
      records = page.rows.map((row) => ({ section: "production", ...row }));
      truncated = page.truncated;
      break;
    }
    case "waste": {
      const page = await store.listWasteStageRecords({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        limit,
        offset,
        ...locationFilter,
      });
      records = page.rows.map((row) => ({ section: "waste", ...row }));
      truncated = page.truncated;
      break;
    }
    default:
      throw new DomainError(`unknown operations report section "${String(input.section)}"`);
  }

  return {
    asOf: new Date().toISOString(),
    scope,
    period: { from: input.from, to: input.to },
    grain: input.grain,
    currency: SALES_REPORT_CURRENCY,
    section: input.section,
    records,
    truncated,
    limit,
    offset,
    notes: [drilldownNote(input.section)],
  };
}
