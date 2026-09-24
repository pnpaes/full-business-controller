import {
  DomainError,
  MONEY_SCALE,
  contributionBeforeLabour,
  contributionMarginPctOrNull,
  isSalesReportGrain,
  parseDecimal,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import { SALES_REPORT_UNMAPPED_KEY, type ReportingStore, type SalesGroupRow } from "../reporting";

import { computeBenchmarks } from "./benchmarks";
import { below, belowFraction } from "./math";
import { computeTrends } from "./trends";
import {
  ANALYTICS_RATIO_SCALE,
  DEFAULT_TREND_PERIODS,
  type AnalyticsScope,
  type BenchmarkReport,
  type ComputeSuggestionsInput,
  type Suggestion,
  type SuggestionRuleRun,
  type SuggestionSeverity,
  type SuggestionsReport,
  type TrendSeries,
} from "./types";

/**
 * Rule-based, explainable suggestions (`W6`).
 *
 * **No AI, no opaque scoring.** Each suggestion is a transparent rule with its
 * id and the figures that fired it. The recorded posture is advisory-only with
 * human approval (`DEC-039`), so nothing is ever auto-applied and every
 * suggestion carries its evidence and a suggested next action. The rules are
 * derived from the computed facts — a metric trending beyond its flat band, an
 * entity below the peer median by more than a stated threshold, a product with
 * negative or thin contribution, rising waste, falling yield.
 */

/** The stated posture: advisory only, human approval, no auto-apply. */
export const SUGGESTIONS_POSTURE_NOTE =
  "rule-based advisories only: each suggestion names its rule and evidence and is never applied automatically — a human decides (DEC-039)";

/** The peer-median shortfall that fires the below-median rule (25% below the median). */
export const SUGGESTION_BELOW_MEDIAN_FRACTION = "0.250000";

/** The contribution margin below which a product is "thin" (10%). */
export const SUGGESTION_THIN_MARGIN_PCT = "10.000000";

/** The caveat: a benchmark suggestion is against internal peers only. */
export const SUGGESTION_INTERNAL_BENCHMARK_NOTE =
  "the peer-median rules compare against the organization's own entities — there is no external market data";

/** The rule catalogue: id, title and the fact it evaluates. */
export const SUGGESTION_RULES = [
  { ruleId: "R-REVENUE-DECLINING", title: "Revenue is trending down" },
  { ruleId: "R-CONTRIBUTION-DECLINING", title: "Contribution is trending down" },
  { ruleId: "R-WASTE-RISING", title: "Waste value is rising" },
  { ruleId: "R-YIELD-FALLING", title: "Production yield is falling" },
  { ruleId: "R-BELOW-PEER-MEDIAN", title: "Below the peer median" },
  { ruleId: "R-THIN-CONTRIBUTION", title: "Thin or negative product contribution" },
] as const;

/** The severity order for sorting (high first). */
const SEVERITY_ORDER: Record<SuggestionSeverity, number> = { high: 0, medium: 1, low: 2 };

/** The evidence for a trend's latest point, shared by the trend rules. */
function trendEvidence(
  trend: TrendSeries,
  last: TrendSeries["points"][number],
): Suggestion["evidence"] {
  return [
    { label: "period", value: last.period },
    { label: "value", value: last.value ?? "n/a" },
    { label: "previous value", value: last.previousValue ?? "n/a" },
    { label: "relative change", value: last.relativeChange ?? "n/a" },
    { label: "flat band (fraction)", value: trend.flatBandFraction },
  ];
}

/**
 * Fires when the trend's latest period moves in `direction` (already beyond the
 * flat band — a `flat` direction never matches). The first period and an
 * undefined latest value never fire.
 */
export function trendDirectionSuggestion(options: {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: SuggestionSeverity;
  readonly trend: TrendSeries;
  readonly direction: "up" | "down";
  readonly action: string;
}): Suggestion | null {
  const last = options.trend.points[options.trend.points.length - 1];
  if (last === undefined || last.direction !== options.direction) {
    return null;
  }
  return {
    ruleId: options.ruleId,
    title: options.title,
    severity: options.severity,
    advisory: true,
    metric: options.trend.metric,
    subject: { kind: "metric", id: null, label: options.trend.metricLabel },
    evidence: trendEvidence(options.trend, last),
    action: options.action,
  };
}

/** R-REVENUE-DECLINING: net sales' latest period is down beyond the flat band. */
export function revenueDecliningSuggestion(trend: TrendSeries): Suggestion | null {
  return trendDirectionSuggestion({
    ruleId: "R-REVENUE-DECLINING",
    title: "Revenue is trending down",
    severity: "medium",
    trend,
    direction: "down",
    action: "Review the sales mix, channel performance and opening hours for the latest period.",
  });
}

/** R-CONTRIBUTION-DECLINING: contribution's latest period is down beyond the flat band. */
export function contributionDecliningSuggestion(trend: TrendSeries): Suggestion | null {
  return trendDirectionSuggestion({
    ruleId: "R-CONTRIBUTION-DECLINING",
    title: "Contribution is trending down",
    severity: "high",
    trend,
    direction: "down",
    action:
      "Review ingredient cost and product mix: contribution is falling faster than net sales.",
  });
}

/** R-WASTE-RISING: waste value's latest period is up beyond the flat band. */
export function wasteRisingSuggestion(trend: TrendSeries): Suggestion | null {
  return trendDirectionSuggestion({
    ruleId: "R-WASTE-RISING",
    title: "Waste value is rising",
    severity: "medium",
    trend,
    direction: "up",
    action: "Review waste by stage and reason for the latest period and the largest contributors.",
  });
}

/** R-YIELD-FALLING: production yield's latest period is down beyond the flat band. */
export function yieldFallingSuggestion(trend: TrendSeries): Suggestion | null {
  return trendDirectionSuggestion({
    ruleId: "R-YIELD-FALLING",
    title: "Production yield is falling",
    severity: "high",
    trend,
    direction: "down",
    action: "Review the batches with the largest yield variance and the recipe's expected yield.",
  });
}

/**
 * R-BELOW-PEER-MEDIAN: an entity whose value is more than the stated fraction
 * below the peer median of the same dimension. The unmapped bucket and an
 * undefined median never fire.
 */
export function belowPeerMedianSuggestions(benchmark: BenchmarkReport): readonly Suggestion[] {
  if (
    benchmark.peerMedian === null ||
    parseDecimal(benchmark.peerMedian, metricScale(benchmark)) <= 0n
  ) {
    return [];
  }
  const kind = benchmark.dimension === "product" ? "product" : benchmark.dimension;
  const suggestions: Suggestion[] = [];
  for (const entity of benchmark.entities) {
    if (entity.isUnmapped || entity.value === null || entity.ratioToPeerMedian === null) {
      continue;
    }
    if (
      !belowFraction(
        entity.ratioToPeerMedian,
        SUGGESTION_BELOW_MEDIAN_FRACTION,
        ANALYTICS_RATIO_SCALE,
      )
    ) {
      continue;
    }
    suggestions.push({
      ruleId: "R-BELOW-PEER-MEDIAN",
      title: `${entity.label} is below the peer median`,
      severity: "medium",
      advisory: true,
      metric: benchmark.metric,
      subject: { kind, id: entity.entityId, label: entity.label },
      evidence: [
        { label: "value", value: entity.value },
        { label: "peer median", value: benchmark.peerMedian },
        { label: "ratio to median (fraction)", value: entity.ratioToPeerMedian },
        { label: "shortfall threshold (fraction)", value: SUGGESTION_BELOW_MEDIAN_FRACTION },
      ],
      action: `Review ${benchmark.dimensionLabel.toLowerCase()} ${entity.label}'s sales mix, opening hours and cost base against the peer median.`,
    });
  }
  return suggestions;
}

/**
 * R-THIN-CONTRIBUTION: a product whose contribution before labour is negative,
 * or whose contribution margin is below the stated thin threshold. The unmapped
 * bucket is skipped (no product to act on).
 */
export function thinContributionSuggestions(rows: readonly SalesGroupRow[]): readonly Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const row of rows) {
    if (row.key === SALES_REPORT_UNMAPPED_KEY) {
      continue;
    }
    const contribution = contributionBeforeLabour(row.netSales, row.ingredientCost);
    const margin = contributionMarginPctOrNull(row.netSales, contribution);
    const negative = parseDecimal(contribution, MONEY_SCALE) < 0n;
    const thin =
      margin !== null && below(margin, SUGGESTION_THIN_MARGIN_PCT, ANALYTICS_RATIO_SCALE);
    if (!negative && !thin) {
      continue;
    }
    suggestions.push({
      ruleId: "R-THIN-CONTRIBUTION",
      title: `${row.label} has ${negative ? "negative" : "thin"} contribution`,
      severity: negative ? "high" : "medium",
      advisory: true,
      metric: "contribution",
      subject: { kind: "product", id: row.productVariantId, label: row.label },
      evidence: [
        { label: "net sales", value: row.netSales },
        { label: "ingredient cost", value: row.ingredientCost },
        { label: "contribution before labour", value: contribution },
        { label: "contribution margin (%)", value: margin ?? "n/a" },
        { label: "thin threshold (%)", value: SUGGESTION_THIN_MARGIN_PCT },
      ],
      action: negative
        ? "Review the product's price and recipe cost, or remove it from the menu."
        : "Review the product's price and recipe cost to lift its contribution margin.",
    });
  }
  return suggestions;
}

/** The metric's working scale for the benchmark median guard (money/quantity/count). */
function metricScale(benchmark: BenchmarkReport): number {
  if (benchmark.metric === "units") {
    return 6;
  }
  if (benchmark.metric === "transactions") {
    return 0;
  }
  return MONEY_SCALE;
}

/**
 * Computes the rule-based suggestions over `period`. It gathers the facts once —
 * a trend per metric, a location benchmark on revenue and the per-product rows —
 * then applies every rule and returns the fired suggestions sorted by severity
 * (high first). `grain` defaults to `month` and `trendPeriods` to
 * `DEFAULT_TREND_PERIODS` (6). A malformed period is a `DomainError` before the
 * store is touched.
 */
export async function computeSuggestions(
  store: ReportingStore,
  input: ComputeSuggestionsInput,
): Promise<SuggestionsReport> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  assertIsoInstant(input.period.from, "from");
  assertIsoInstant(input.period.to, "to");
  if (Date.parse(input.period.from) > Date.parse(input.period.to)) {
    throw new DomainError("from must be on or before to");
  }
  const grain = input.grain ?? "month";
  if (!isSalesReportGrain(grain)) {
    throw new DomainError(`unknown sales report grain "${String(grain)}"`);
  }
  const trendPeriods =
    input.trendPeriods === undefined ||
    !Number.isInteger(input.trendPeriods) ||
    input.trendPeriods < 2
      ? DEFAULT_TREND_PERIODS
      : input.trendPeriods;

  const locationIds =
    input.locationIds === undefined || input.locationIds.length === 0
      ? null
      : [...input.locationIds];
  const scope: AnalyticsScope = { locationIds, channelId: null };
  const locationFilter = locationIds === null ? {} : { locationIds };

  const trendInput = {
    organizationId: input.organizationId,
    grain,
    periods: trendPeriods,
    now: input.period.to,
    ...locationFilter,
  };
  // Sequential: the reads may share one transaction client.
  const revenueTrend = await computeTrends(store, { ...trendInput, metric: "revenue" });
  const contributionTrend = await computeTrends(store, { ...trendInput, metric: "contribution" });
  const wasteTrend = await computeTrends(store, { ...trendInput, metric: "waste" });
  const yieldTrend = await computeTrends(store, { ...trendInput, metric: "production_yield" });
  const locationBenchmark = await computeBenchmarks(store, {
    organizationId: input.organizationId,
    dimension: "location",
    metric: "revenue",
    period: input.period,
    ...locationFilter,
  });
  const productSummary = await store.summarizeSales({
    organizationId: input.organizationId,
    from: input.period.from,
    to: input.period.to,
    grain: "month",
    groupBy: "product",
    ...locationFilter,
  });

  const suggestions: Suggestion[] = [
    revenueDecliningSuggestion(revenueTrend),
    contributionDecliningSuggestion(contributionTrend),
    wasteRisingSuggestion(wasteTrend),
    yieldFallingSuggestion(yieldTrend),
  ].filter((suggestion): suggestion is Suggestion => suggestion !== null);
  suggestions.push(...belowPeerMedianSuggestions(locationBenchmark));
  suggestions.push(...thinContributionSuggestions(productSummary.rows));

  suggestions.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);

  const firedByRule = new Map<string, number>();
  for (const suggestion of suggestions) {
    firedByRule.set(suggestion.ruleId, (firedByRule.get(suggestion.ruleId) ?? 0) + 1);
  }
  const evaluated: SuggestionRuleRun[] = SUGGESTION_RULES.map((rule) => ({
    ruleId: rule.ruleId,
    title: rule.title,
    fired: firedByRule.get(rule.ruleId) ?? 0,
  }));

  return {
    asOf: new Date().toISOString(),
    period: { from: input.period.from, to: input.period.to },
    scope,
    posture: "advisory_only",
    postureNote: SUGGESTIONS_POSTURE_NOTE,
    suggestions,
    evaluated,
    notes: [SUGGESTIONS_POSTURE_NOTE, SUGGESTION_INTERNAL_BENCHMARK_NOTE],
  };
}
