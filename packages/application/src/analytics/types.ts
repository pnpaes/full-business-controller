import type { SalesReportGrain } from "@aquarela/domain";
import { FORECAST_GRAIN } from "@aquarela/persistence";

/**
 * Application-level ports and DTOs for the analytics read model (`W6` —
 * trends, benchmarks, predictability and rule-based suggestions).
 *
 * This is a **read-only analytical layer over data that already exists**: every
 * computation runs over the existing reporting reads (`ReportingStore`), so
 * there is no new SQL, no aggregate table, no schema change and no audit fact.
 * The metric definitions live in the domain (`contributionBeforeLabour`,
 * `medianDecimal`, `yieldRatio`); this slice only composes, compares and
 * labels them.
 *
 * **Honesty is the contract.** Every result states its method, its inputs and
 * its error/uncertainty; a benchmark states that it is internal; a forecast is
 * labelled a model, never a fact; every suggestion carries its rule id and the
 * figures that fired it. Nothing presents a projection as a recorded fact.
 */

/** The metrics the analytics reads can compute from the existing reporting reads. */
export const ANALYTICS_METRICS = [
  "revenue",
  "contribution",
  "units",
  "transactions",
  "average_order_value",
  "production_yield",
  "waste",
] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

/** True when `value` is one of `ANALYTICS_METRICS`. */
export function isAnalyticsMetric(value: string): value is AnalyticsMetric {
  return (ANALYTICS_METRICS as readonly string[]).includes(value);
}

/** The dimensions a benchmark can compare (`W6`). */
export const BENCHMARK_DIMENSIONS = ["location", "product", "channel"] as const;
export type BenchmarkDimension = (typeof BENCHMARK_DIMENSIONS)[number];

/** True when `value` is one of `BENCHMARK_DIMENSIONS`. */
export function isBenchmarkDimension(value: string): value is BenchmarkDimension {
  return (BENCHMARK_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * The metrics a benchmark supports: the sales-derived subset. Production yield
 * and waste have no product/channel attribution and the existing reads do not
 * group them by the benchmark dimensions, so benchmarking them is not built —
 * a `DomainError` names the supported set rather than returning a number the
 * data cannot support.
 */
export const BENCHMARK_METRICS = [
  "revenue",
  "contribution",
  "units",
  "transactions",
  "average_order_value",
] as const;
export type BenchmarkMetric = (typeof BENCHMARK_METRICS)[number];

/** True when `value` is one of `BENCHMARK_METRICS`. */
export function isBenchmarkMetric(value: string): value is BenchmarkMetric {
  return (BENCHMARK_METRICS as readonly string[]).includes(value);
}

/** The direction of a period-over-period change. */
export type TrendDirection = "up" | "down" | "flat";

/** The unit a metric's figures are expressed in. */
export type MetricUnit = "money" | "quantity" | "count" | "ratio";

/** The scale (decimal places) the analytics maths works at for a metric. */
export const ANALYTICS_RATIO_SCALE = 6;

/** The default period-over-period flat band: a change under 5% reads as flat. */
export const ANALYTICS_FLAT_BAND_FRACTION = "0.050000";

/** The default number of periods a trend/forecast reads back over. */
export const DEFAULT_TREND_PERIODS = 6;
export const DEFAULT_FORECAST_HISTORY_PERIODS = 12;
export const DEFAULT_FORECAST_HORIZON_PERIODS = 3;

/** The minimum history points a least-squares fit needs (n − 2 residual d.o.f.). */
export const FORECAST_MINIMUM_HISTORY_POINTS = 3;

/** A safety ceiling on the periods a single analytics read will fetch. */
export const ANALYTICS_MAX_PERIODS = 60;

/** The reporting currency (`DEC-104` hard-codes NOK; the organization's own). */
export const ANALYTICS_CURRENCY = "NOK";

/** One metric's presentation and maths specification. */
export interface AnalyticsMetricSpec {
  readonly label: string;
  readonly unit: MetricUnit;
  readonly scale: number;
  /** The metric's definition, stated on every result that carries it. */
  readonly definition: string;
}

/**
 * The metric definitions, stated once so the trend, benchmark, forecast and
 * suggestion results all describe the same figure the same way. Money and
 * quantities are decimal only (`DEC-024`); `transactions` is a count.
 */
export const ANALYTICS_METRIC_SPECS: Record<AnalyticsMetric, AnalyticsMetricSpec> = {
  revenue: {
    label: "Net sales",
    unit: "money",
    scale: 4,
    definition:
      "net sales summed from the posted sales lines (net_amount, else gross − tax − discount − refund); included add-on lines are excluded (SALE-011)",
  },
  contribution: {
    label: "Contribution before labour",
    unit: "money",
    scale: 4,
    definition:
      "net sales minus the moving-average ingredient cost posted to the stock ledger; excludes direct labour, channel fees and allocated overhead (DEC-063)",
  },
  units: {
    label: "Units",
    unit: "quantity",
    scale: 6,
    definition:
      "summed sales_line.quantity (a reversal line is a negated row, so a plain sum nets it)",
  },
  transactions: {
    label: "Transactions",
    unit: "count",
    scale: 0,
    definition: "distinct sales transactions that contribute at least one non-included line",
  },
  average_order_value: {
    label: "Average order value",
    unit: "money",
    scale: 4,
    definition:
      "net sales ÷ transactions, HALF_UP at 4 dp (DEC-024); undefined (null) when the period has no transaction",
  },
  production_yield: {
    label: "Production yield",
    unit: "ratio",
    scale: 6,
    definition:
      "actual ÷ planned output over completed batches (DEC-110 item 5); undefined (null) when planned output is non-positive",
  },
  waste: {
    label: "Waste value",
    unit: "money",
    scale: 4,
    definition:
      "moving-average waste value (DEC-068); undefined (null) when the period has no valued waste event, never a silent zero",
  },
};

/** An ISO-inclusive period window. */
export interface AnalyticsPeriod {
  /** Inclusive lower bound; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound; an ISO instant. */
  readonly to: string;
}

/** The echoed filters an analytics result was produced with (`FND-006`). */
export interface AnalyticsScope {
  /** `null` = organization-wide. */
  readonly locationIds: readonly string[] | null;
  readonly channelId: string | null;
}

/** One period of a trend series and its comparison against the previous period. */
export interface TrendPoint {
  /** The grain bucket label (e.g. `2026-09`). */
  readonly period: string;
  readonly from: string;
  readonly to: string;
  /** `null` when the metric is undefined for the period (never a silent zero). */
  readonly value: string | null;
  readonly previousValue: string | null;
  /** `value − previousValue` at the metric's scale; `null` when either is undefined. */
  readonly absoluteChange: string | null;
  /** `(value − previous) / previous` as a fraction at 6 dp; `null` when the previous is 0/undefined. */
  readonly relativeChange: string | null;
  /** `null` for the first period (no comparison exists). */
  readonly direction: TrendDirection | null;
}

/** A period-over-period trend series with its method and window stated. */
export interface TrendSeries {
  readonly asOf: string;
  readonly metric: AnalyticsMetric;
  readonly metricLabel: string;
  readonly unit: MetricUnit;
  readonly grain: SalesReportGrain;
  readonly scope: AnalyticsScope;
  readonly method: string;
  /** The flat band as a fraction at 6 dp (a change within it reads as flat). */
  readonly flatBandFraction: string;
  readonly points: readonly TrendPoint[];
  readonly notes: readonly string[];
}

export interface ComputeTrendsInput {
  readonly organizationId: string;
  readonly metric: AnalyticsMetric;
  readonly grain: SalesReportGrain;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string | undefined;
  /** The number of periods to read back from `now`; defaults to 6. */
  readonly periods?: number | undefined;
  /** The window anchor; an ISO instant. Defaults to the current instant. */
  readonly now?: string | undefined;
}

/** One benchmarked entity: its value against the organization and peer median. */
export interface BenchmarkEntity {
  /** The dimension id; `null` for the unmapped bucket. */
  readonly entityId: string | null;
  readonly label: string;
  /** True for the bucket of rows with no value for the dimension (never ranked). */
  readonly isUnmapped: boolean;
  readonly value: string | null;
  /** Standard competition rank (1, 2, 2, 4) among mapped entities; `null` when unranked. */
  readonly rank: number | null;
  /** `value / organizationAggregate` as a fraction at 6 dp; `null` when either is 0/undefined. */
  readonly ratioToOrganization: string | null;
  /** `value / peerMedian` as a fraction at 6 dp; `null` when either is 0/undefined. */
  readonly ratioToPeerMedian: string | null;
  /** True when `value >= peerMedian` (`DEC-109` item 1 boundary); `null` when undefined. */
  readonly meetsPeerMedian: boolean | null;
}

/** A benchmark report: each entity against the organization and the peer median. */
export interface BenchmarkReport {
  readonly asOf: string;
  readonly metric: BenchmarkMetric;
  readonly metricLabel: string;
  readonly unit: MetricUnit;
  readonly dimension: BenchmarkDimension;
  readonly dimensionLabel: string;
  readonly period: AnalyticsPeriod;
  readonly scope: AnalyticsScope;
  /** Always `"internal"`: there is no external market data in this system. */
  readonly basis: "internal";
  readonly basisNote: string;
  readonly organizationAggregate: string | null;
  /** The median of the mapped entities' values; `null` when none is computable. */
  readonly peerMedian: string | null;
  readonly entities: readonly BenchmarkEntity[];
  readonly notes: readonly string[];
}

export interface ComputeBenchmarksInput {
  readonly organizationId: string;
  readonly dimension: BenchmarkDimension;
  readonly metric: BenchmarkMetric;
  readonly period: AnalyticsPeriod;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string | undefined;
}

/** One fitted history point: the actual value and the model's fitted value. */
export interface ForecastHistoryPoint {
  readonly period: string;
  readonly value: string;
  readonly fitted: string;
}

/** One projected point: the model's value and its ±1 residual-σ band. */
export interface ForecastProjectionPoint {
  readonly period: string;
  readonly value: string;
  readonly lower: string;
  readonly upper: string;
}

/** The stated forecast model: method, parameters and confidence. */
export interface ForecastModel {
  readonly method: "least_squares_linear";
  readonly methodNote: string;
  readonly slopePerPeriod: string;
  readonly intercept: string;
  readonly confidence: {
    readonly method: string;
    readonly bandScale: string;
  };
}

/** The backtested historical accuracy of the model. */
export interface ForecastAccuracy {
  readonly method: "mape";
  readonly methodNote: string;
  /** Mean absolute percentage error as a fraction at 6 dp; `null` when no non-zero actual. */
  readonly mape: string | null;
  /** The number of history points the error was measured over. */
  readonly points: number;
}

/** The explicit result when history is too short to fit honestly. */
export interface ForecastInsufficient {
  readonly status: "insufficient_history";
  readonly reason: string;
  readonly historyPoints: number;
  readonly minimumPoints: number;
}

/**
 * A forecast result. `status` is `"ok"` with a model and projection, or
 * `"insufficient_history"` with the reason and no number — never a fabricated
 * projection from too little history.
 */
export interface ForecastResult {
  readonly asOf: string;
  readonly metric: AnalyticsMetric;
  readonly metricLabel: string;
  readonly unit: MetricUnit;
  readonly grain: SalesReportGrain;
  readonly scope: AnalyticsScope;
  readonly status: "ok" | "insufficient_history";
  /** The model's method, stated on every result. */
  readonly method: string;
  readonly history: readonly ForecastHistoryPoint[];
  readonly projection: readonly ForecastProjectionPoint[];
  readonly model: ForecastModel | null;
  readonly accuracy: ForecastAccuracy | null;
  readonly insufficient: ForecastInsufficient | null;
  readonly notes: readonly string[];
}

export interface ComputeForecastInput {
  readonly organizationId: string;
  readonly metric: AnalyticsMetric;
  readonly grain: SalesReportGrain;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
  readonly channelId?: string | undefined;
  /** The number of history periods to fit over; defaults to 12. */
  readonly historyPeriods?: number | undefined;
  /** The number of periods to project; defaults to 3. */
  readonly horizonPeriods?: number | undefined;
  /** The window anchor; an ISO instant. Defaults to the current instant. */
  readonly now?: string | undefined;
}

/** The severity of a suggestion. */
export type SuggestionSeverity = "high" | "medium" | "low";

/** One figure behind a suggestion: the evidence that fired the rule. */
export interface SuggestionEvidence {
  readonly label: string;
  readonly value: string;
}

/** The subject a suggestion is about (a location, a product, the organization). */
export interface SuggestionSubject {
  readonly kind: "metric" | "location" | "product" | "channel";
  readonly id: string | null;
  readonly label: string;
}

/** One transparent, rule-based advisory. Never auto-applied (`DEC-039`). */
export interface Suggestion {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: SuggestionSeverity;
  /** Always true: the recorded posture is advisory-only with human approval. */
  readonly advisory: true;
  /** The metric the evidence is about; `null` for a non-metric (e.g. a product). */
  readonly metric: AnalyticsMetric | null;
  readonly subject: SuggestionSubject;
  readonly evidence: readonly SuggestionEvidence[];
  readonly action: string;
}

/** One rule's evaluation count, so a screen can say which rules ran. */
export interface SuggestionRuleRun {
  readonly ruleId: string;
  readonly title: string;
  readonly fired: number;
}

export interface SuggestionsReport {
  readonly asOf: string;
  readonly period: AnalyticsPeriod;
  readonly scope: AnalyticsScope;
  /** Always `"advisory_only"`: no AI, no opaque scoring, no auto-apply (`DEC-039`). */
  readonly posture: "advisory_only";
  readonly postureNote: string;
  readonly suggestions: readonly Suggestion[];
  readonly evaluated: readonly SuggestionRuleRun[];
  readonly notes: readonly string[];
}

export interface ComputeSuggestionsInput {
  readonly organizationId: string;
  readonly period: AnalyticsPeriod;
  /** The grain the trend scan steps at; defaults to `month`. */
  readonly grain?: SalesReportGrain | undefined;
  /** The trend periods to scan; defaults to `DEFAULT_TREND_PERIODS` (6). */
  readonly trendPeriods?: number | undefined;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[] | undefined;
}

/*
 * `DEC-011` (row 15, `FCST-001`–`FCST-002`): forecast-vs-actual tracking.
 *
 * The grain vocabulary is the **database's** (`FORECAST_GRAIN`, from
 * `schemas/domain-enums.yaml`) rather than a second list, so the schema check
 * and the application agree by construction. The tracking read reports
 * `insufficient_history` below `FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS`
 * completed periods and a distinct `no_snapshot` state — never a fabricated
 * accuracy. `DEC-011`'s category/product grains are declared but not yet
 * implemented: the underlying reporting read cannot scope by category or
 * product, so the commands refuse them rather than mis-scope a snapshot.
 */

/** The grain a forecast snapshot is taken at (the declared vocabulary). */
export const FORECAST_GRAINS = FORECAST_GRAIN;
export type ForecastGrain = (typeof FORECAST_GRAIN)[number];

/** True when `value` is one of `FORECAST_GRAINS`. */
export function isForecastGrain(value: string): value is ForecastGrain {
  return (FORECAST_GRAINS as readonly string[]).includes(value);
}

/**
 * The one forecast grain this slice implements. `DEC-011` accepted
 * location/category and product grains too, but the reporting read underneath
 * cannot scope by category or product, so the commands refuse the other two
 * rather than store a snapshot that dropped its scope (the recorded ceiling).
 */
export const SUPPORTED_FORECAST_GRAINS = ["day_location"] as const;
export type SupportedForecastGrain = (typeof SUPPORTED_FORECAST_GRAINS)[number];

/** True when `value` is one of `SUPPORTED_FORECAST_GRAINS`. */
export function isSupportedForecastGrain(value: string): value is SupportedForecastGrain {
  return (SUPPORTED_FORECAST_GRAINS as readonly string[]).includes(value);
}

/**
 * Every forecast grain buckets by **day** (the reporting `day` grain); the
 * location/category/product dimensions are carried as the scope, not the bucket.
 */
export const FORECAST_GRAIN_TO_SALES_REPORT_GRAIN: Record<ForecastGrain, SalesReportGrain> = {
  day_location: "day",
  day_location_category: "day",
  day_location_product: "day",
};

/** The failed lookup states `computeForecastTracking` reports honestly. */
export const FORECAST_TRACKING_STATUSES = ["ok", "insufficient_history", "no_snapshot"] as const;
export type ForecastTrackingStatus = (typeof FORECAST_TRACKING_STATUSES)[number];

/**
 * The completed periods a scope must have before tracking reports a MAPE. Four
 * is the agreed floor (the same spirit as the forecast fit's own minimum): a
 * mean over fewer points is not reported, the result stays
 * `insufficient_history` instead.
 */
export const FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS = 4;

/** The echoed scope of a forecast snapshot/tracking read. */
export interface ForecastScope {
  /** `null` = organization-wide (the repo convention). */
  readonly locationId: string | null;
  readonly channelId: string | null;
  /** Populated only for the (not-yet-implemented) category grain. */
  readonly category: string | null;
  /** Populated only for the (not-yet-implemented) product grain. */
  readonly productVariantId: string | null;
}

/** One completed projected period, its actual and the error between them. */
export interface ForecastTrackingPeriod {
  /** The day bucket (`YYYY-MM-DD`). */
  readonly period: string;
  readonly from: string;
  readonly to: string;
  /** The snapshot's projected value (a model figure, at the metric's scale). */
  readonly projected: string;
  /** The actual value; `null` when the metric is undefined for the period. */
  readonly actual: string | null;
  /** `|actual − projected|` at the metric's scale; `null` when the actual is undefined. */
  readonly absoluteError: string | null;
  /** `|actual − projected| / |actual|` as a fraction at 6 dp; `null` when the actual is 0/undefined. */
  readonly percentageError: string | null;
}

/** The out-of-sample accuracy computed from the completed periods. */
export interface ForecastTrackingAccuracy {
  readonly method: "mape";
  readonly methodNote: string;
  /** Mean absolute percentage error as a fraction at 6 dp; `null` when no non-zero actual. */
  readonly mape: string | null;
  /** The completed periods the error was measured over (non-zero actuals). */
  readonly periods: number;
}

/** One advisory override, surfaced next to the projection (never auto-applied). */
export interface ForecastOverrideSummary {
  readonly id: string;
  readonly snapshotId: string | null;
  readonly period: string;
  readonly actorId: string;
  readonly reason: string;
  /** `timestamptz`, ISO. */
  readonly recordedAt: string;
}

/**
 * A forecast-vs-actual tracking report. `status` is `"ok"` with the completed
 * periods and their MAPE, `"insufficient_history"` below
 * `FORECAST_TRACKING_MINIMUM_COMPLETED_PERIODS` completed periods (the reason is
 * stated, the accuracy is `null`), or `"no_snapshot"` when the scope has never
 * had a snapshot recorded — never a fabricated number.
 */
export interface ForecastTrackingReport {
  readonly asOf: string;
  readonly metric: AnalyticsMetric;
  readonly metricLabel: string;
  readonly unit: MetricUnit;
  readonly grain: ForecastGrain;
  readonly scope: ForecastScope;
  readonly status: ForecastTrackingStatus;
  /** The snapshot being tracked; `null` for `no_snapshot`. */
  readonly snapshotId: string | null;
  readonly snapshotAsOf: string | null;
  readonly snapshotGeneratedAt: string | null;
  /** The snapshot's stated model id; `null` for `no_snapshot`. */
  readonly model: string | null;
  readonly completedPeriods: number;
  readonly minimumCompletedPeriods: number;
  /** Projected vs actual for each **completed** projected period. */
  readonly periods: readonly ForecastTrackingPeriod[];
  readonly accuracy: ForecastTrackingAccuracy | null;
  /** Advisory overrides recorded for this scope (`DEC-011`); never auto-applied. */
  readonly overrides: readonly ForecastOverrideSummary[];
  /** The reason the accuracy is not reported, for the two non-ok states. */
  readonly reason: string | null;
  readonly notes: readonly string[];
}

export interface ComputeForecastTrackingInput {
  readonly organizationId: string;
  readonly metric: AnalyticsMetric;
  readonly grain: ForecastGrain;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationId?: string | null | undefined;
  readonly channelId?: string | null | undefined;
  /** The observation instant; defaults to the current instant. */
  readonly now?: string | undefined;
}
