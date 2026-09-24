import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  isHighAgainst,
  medianDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import {
  SALES_REPORT_UNMAPPED_KEY,
  type ReportingStore,
  type SalesGroupRow,
  type SalesMeasures,
} from "../reporting";

import { ratio } from "./math";
import { salesMetricValue } from "./series";
import {
  ANALYTICS_RATIO_SCALE,
  BENCHMARK_METRICS,
  isBenchmarkDimension,
  isBenchmarkMetric,
  type AnalyticsScope,
  type BenchmarkDimension,
  type BenchmarkEntity,
  type BenchmarkReport,
  type ComputeBenchmarksInput,
} from "./types";

/**
 * Internal benchmarks (`W6`): each entity's value against the **organization
 * aggregate** and against the **peer median** of the same dimension, with the
 * ratio and a rank.
 *
 * **The benchmark is internal.** There is no external market data in this
 * system, so the comparison is only ever against the organization's own
 * aggregate and the median of its own entities — the result says so
 * (`basis: "internal"`, `basisNote`) and the UI must not imply otherwise.
 *
 * The peer median reuses the domain `medianDecimal` (`DEC-109` item 1: metric
 * definitions live once) and the rank is standard competition ranking (1, 2, 2,
 * 4) over the mapped entities only; the `unmapped` bucket is listed but never
 * ranked or allowed to move the median. Decimal only (`DEC-024`).
 */

/** The dimension labels for the benchmark table header. */
const DIMENSION_LABELS: Record<BenchmarkDimension, string> = {
  location: "Location",
  product: "Product",
  channel: "Channel",
};

/** The stated basis: this benchmark is internal, with no external market data. */
export const BENCHMARK_BASIS_NOTE =
  "internal benchmark only: each entity is compared with the organization aggregate and the peer median of the same dimension — there is no external market data in this system";

/** The caveat: the unmapped bucket is listed but not ranked. */
export const BENCHMARK_UNMAPPED_NOTE =
  "the unmapped bucket (rows with no value for the dimension) is listed for completeness but is excluded from the peer median and the ranking";

/**
 * Computes the benchmark. `organizationId`, `dimension`, `metric` and the
 * `period` are required; the metric must be one of `BENCHMARK_METRICS` (the
 * sales-derived subset — production yield and waste have no dimension
 * attribution). A malformed period is a `DomainError` before the store is
 * touched.
 */
export async function computeBenchmarks(
  store: ReportingStore,
  input: ComputeBenchmarksInput,
): Promise<BenchmarkReport> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (!isBenchmarkDimension(input.dimension)) {
    throw new DomainError(`unknown benchmark dimension "${String(input.dimension)}"`);
  }
  if (!isBenchmarkMetric(input.metric)) {
    throw new DomainError(
      `unknown benchmark metric "${String(input.metric)}"; supported: ${BENCHMARK_METRICS.join(", ")}`,
    );
  }
  assertIsoInstant(input.period.from, "from");
  assertIsoInstant(input.period.to, "to");
  if (Date.parse(input.period.from) > Date.parse(input.period.to)) {
    throw new DomainError("from must be on or before to");
  }

  const locationIds =
    input.locationIds === undefined || input.locationIds.length === 0
      ? null
      : [...input.locationIds];
  const scope: AnalyticsScope = { locationIds, channelId: input.channelId ?? null };

  const summary = await store.summarizeSales({
    organizationId: input.organizationId,
    from: input.period.from,
    to: input.period.to,
    grain: "month",
    groupBy: input.dimension,
    ...(locationIds === null ? {} : { locationIds }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
  });

  const scale = metricScale(input.metric);
  const organizationAggregate = salesMetricValue(
    input.metric,
    aggregateMeasures(summary.rows, summary.transactions),
  );

  const mapped = summary.rows.filter((row) => row.key !== SALES_REPORT_UNMAPPED_KEY);
  const mappedValues = mapped
    .map((row) => salesMetricValue(input.metric, row))
    .filter((value): value is string => value !== null);
  const peerMedian = medianDecimal(mappedValues);

  const ranks = competitionRanks(
    mapped
      .map((row) => salesMetricValue(input.metric, row))
      .map((value, index) => ({ index, value }))
      .filter((entry): entry is { index: number; value: string } => entry.value !== null),
    scale,
  );

  let mappedIndex = -1;
  const entities: BenchmarkEntity[] = summary.rows.map((row) => {
    const value = salesMetricValue(input.metric, row);
    const isUnmapped = row.key === SALES_REPORT_UNMAPPED_KEY;
    let rank: number | null = null;
    if (!isUnmapped) {
      mappedIndex += 1;
      rank = value === null ? null : (ranks.get(mappedIndex) ?? null);
    }
    return {
      entityId: dimensionId(input.dimension, row),
      label: row.label,
      isUnmapped,
      value,
      rank,
      ratioToOrganization:
        value === null || organizationAggregate === null
          ? null
          : ratio(value, organizationAggregate, scale, ANALYTICS_RATIO_SCALE),
      // The unmapped bucket is outside the peer set, so it carries no peer
      // comparison (it would be meaningless against a median it does not join).
      ratioToPeerMedian:
        isUnmapped || value === null || peerMedian === null
          ? null
          : ratio(value, peerMedian, scale, ANALYTICS_RATIO_SCALE),
      meetsPeerMedian:
        isUnmapped || value === null || peerMedian === null
          ? null
          : isHighAgainst(value, peerMedian),
    };
  });

  return {
    asOf: new Date().toISOString(),
    metric: input.metric,
    metricLabel: metricLabel(input.metric),
    unit: metricUnit(input.metric),
    dimension: input.dimension,
    dimensionLabel: DIMENSION_LABELS[input.dimension],
    period: { from: input.period.from, to: input.period.to },
    scope,
    basis: "internal",
    basisNote: BENCHMARK_BASIS_NOTE,
    organizationAggregate,
    peerMedian,
    entities,
    notes: [BENCHMARK_BASIS_NOTE, BENCHMARK_UNMAPPED_NOTE],
  };
}

/** The dimension id of a group row (`null` for the unmapped bucket). */
function dimensionId(dimension: BenchmarkDimension, row: SalesGroupRow): string | null {
  switch (dimension) {
    case "location":
      return row.locationId;
    case "channel":
      return row.channelId;
    case "product":
      return row.productVariantId;
    default:
      return null;
  }
}

/** The organization aggregate measures: the summed rows plus the window count. */
function aggregateMeasures(rows: readonly SalesGroupRow[], transactions: number): SalesMeasures {
  let units = 0n;
  let grossSales = 0n;
  let netSales = 0n;
  let taxAmount = 0n;
  let discountAmount = 0n;
  let refundAmount = 0n;
  let ingredientCost = 0n;
  for (const row of rows) {
    units += parseDecimal(row.units, QUANTITY_SCALE);
    grossSales += parseDecimal(row.grossSales, MONEY_SCALE);
    netSales += parseDecimal(row.netSales, MONEY_SCALE);
    taxAmount += parseDecimal(row.taxAmount, MONEY_SCALE);
    discountAmount += parseDecimal(row.discountAmount, MONEY_SCALE);
    refundAmount += parseDecimal(row.refundAmount, MONEY_SCALE);
    ingredientCost += parseDecimal(row.ingredientCost, MONEY_SCALE);
  }
  return {
    transactions,
    units: formatDecimal(units, QUANTITY_SCALE),
    grossSales: formatDecimal(grossSales, MONEY_SCALE),
    netSales: formatDecimal(netSales, MONEY_SCALE),
    taxAmount: formatDecimal(taxAmount, MONEY_SCALE),
    discountAmount: formatDecimal(discountAmount, MONEY_SCALE),
    refundAmount: formatDecimal(refundAmount, MONEY_SCALE),
    ingredientCost: formatDecimal(ingredientCost, MONEY_SCALE),
  };
}

/**
 * Standard competition ranks (1, 2, 2, 4) over the entries' values, highest
 * first, keyed by the entry's original index. Decimal comparison, never floats.
 */
function competitionRanks(
  entries: readonly { readonly index: number; readonly value: string }[],
  scale: number,
): ReadonlyMap<number, number> {
  const sorted = [...entries].sort((left, right) => {
    const a = parseDecimal(left.value, scale);
    const b = parseDecimal(right.value, scale);
    return a === b ? 0 : a > b ? -1 : 1;
  });
  const ranks = new Map<number, number>();
  let previous: bigint | null = null;
  let rank = 0;
  sorted.forEach((entry, position) => {
    const value = parseDecimal(entry.value, scale);
    if (previous === null || value !== previous) {
      rank = position + 1;
      previous = value;
    }
    ranks.set(entry.index, rank);
  });
  return ranks;
}

/** The metric's working scale (money 4 dp, quantity 6 dp, count 0). */
function metricScale(metric: ComputeBenchmarksInput["metric"]): number {
  if (metric === "units") {
    return QUANTITY_SCALE;
  }
  if (metric === "transactions") {
    return 0;
  }
  return MONEY_SCALE;
}

/** The metric's display label (the `ANALYTICS_METRIC_SPECS` label). */
function metricLabel(metric: ComputeBenchmarksInput["metric"]): string {
  switch (metric) {
    case "revenue":
      return "Net sales";
    case "contribution":
      return "Contribution before labour";
    case "units":
      return "Units";
    case "transactions":
      return "Transactions";
    default:
      return "Average order value";
  }
}

/** The metric's unit. */
function metricUnit(metric: ComputeBenchmarksInput["metric"]): BenchmarkReport["unit"] {
  if (metric === "units") {
    return "quantity";
  }
  if (metric === "transactions") {
    return "count";
  }
  return "money";
}
