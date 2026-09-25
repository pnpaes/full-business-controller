import {
  computeForecast,
  computeForecastTracking,
  computeSuggestions,
  createPostgresForecastStore,
  createPostgresReportingStore,
  type ForecastResult,
  type ForecastTrackingReport,
  type SuggestionsReport,
  type SupportedForecastGrain,
} from "@aquarela/application";
import {
  Alert,
  DataTable,
  EmptyState,
  KpiCard,
  LineChart,
  PageHeader,
  SectionCard,
  StatusPill,
  Tabs,
  color,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import { isForecastWriteAuthorized } from "../../../api/v1/analytics/access";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../../api/v1/reports/access";
import { ForecastTrackingActions } from "../forecast-tracking-actions";
import {
  formatAccuracy,
  formatCompletedPeriods,
  formatTrackingError,
  grainLabel,
  trackingStatusLabel,
  trackingStatusTone,
} from "../forecast-tracking-labels";
import {
  formatFractionPct,
  formatMetricValue,
  isMetric,
  metricLabel,
  METRIC_OPTIONS,
  severityTone,
  SEVERITY_LABELS,
} from "../analytics-labels";
import {
  GRAIN_LABELS,
  GRAIN_OPTIONS,
  formatAsOf,
  isGrain,
  periodForGrain,
} from "../reports/report-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forecast — Aquarela Business Control" };

type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Next's `searchParams` record → a plain `URLSearchParams` (first value wins). */
function toSearchParams(record: SearchParamsRecord): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && value[0] !== undefined) {
      params.set(key, value[0]);
    }
  }
  return params;
}

const paragraph = {
  margin: 0,
  maxWidth: "70ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.text.muted,
} as const;

/**
 * Page-scoped responsive rule (the `insights` landing's pattern): the chart
 * svg carries a fixed pixel width, so CSS constrains it to the panel and the
 * viewBox keeps the aspect ratio — the chart reflows instead of scrolling the
 * page.
 */
const pageCss = `
.forecast-chart svg { width: 100%; height: auto; }
`;

/**
 * Insights → Forecast (`W6`): a simple, honest forecast — a least-squares linear
 * trend fitted over the history, projected over the horizon, with its ±1
 * residual-σ band and its backtested accuracy stated on the page. It is labelled
 * a model, never a fact, and an insufficient history is an explicit state rather
 * than a fabricated number. The rule-based **suggestions panel** sits below.
 * Server component: it calls the application services directly, so the screen
 * and the API cannot drift.
 */
export default async function InsightsForecastPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }
  const access = await loadReportingAccess(session.userId);
  if (!isReportingAuthorized(access, SALES_REPORT_READ_ROLES)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
        <PageHeader title="Forecast" scope="Insights" description="Advisory forecast." />
        <EmptyState title="Not available for your role">
          The analytics reads are not readable by your role.
        </EmptyState>
      </div>
    );
  }

  const params = toSearchParams(await searchParams);
  const metricParam = params.get("metric")?.trim();
  const metric = metricParam !== undefined && isMetric(metricParam) ? metricParam : "revenue";
  const grainParam = params.get("grain")?.trim();
  const grain = grainParam !== undefined && isGrain(grainParam) ? grainParam : "month";
  const historyParam = params.get("historyPeriods")?.trim();
  const historyPeriods =
    historyParam !== undefined && /^\d+$/.test(historyParam) ? Number(historyParam) : 12;
  const horizonParam = params.get("horizonPeriods")?.trim();
  const horizonPeriods =
    horizonParam !== undefined && /^\d+$/.test(horizonParam) ? Number(horizonParam) : 3;
  const period = periodForGrain(grain, new Date());

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;
  const locationFilter = locationIds === undefined ? {} : { locationIds };

  const forecast: ForecastResult = await computeForecast(store, {
    organizationId,
    metric,
    grain,
    historyPeriods: historyPeriods >= 1 && historyPeriods <= 60 ? historyPeriods : 12,
    horizonPeriods: horizonPeriods >= 1 && horizonPeriods <= 60 ? horizonPeriods : 3,
    ...locationFilter,
  });
  const suggestions: SuggestionsReport = await computeSuggestions(store, {
    organizationId,
    period: { from: period.from, to: period.to },
    grain,
    ...locationFilter,
  });

  // Forecast-vs-actual tracking (DEC-011/DEC-138). A snapshot records one
  // location or the whole organization, so tracking is shown only when the
  // caller's scope resolves to a single location (or is organization-wide); a
  // multi-location caller is told why rather than shown an out-of-scope
  // aggregate. Only `day_location` is implemented (the DEC-011 ceiling).
  const trackingGrain: SupportedForecastGrain = "day_location";
  const trackingLocationId = access.locationIds.length === 1 ? access.locationIds[0] : undefined;
  const tracking: ForecastTrackingReport | null =
    access.locationIds.length <= 1
      ? await computeForecastTracking(createPostgresForecastStore(getDb().db), {
          organizationId,
          metric,
          grain: trackingGrain,
          ...(trackingLocationId === undefined ? {} : { locationId: trackingLocationId }),
        })
      : null;
  const canWriteTracking = isForecastWriteAuthorized(access);

  const scopeText =
    forecast.scope.locationIds === null
      ? "All locations"
      : `${forecast.scope.locationIds.length} ${forecast.scope.locationIds.length === 1 ? "location" : "locations"}`;
  const meta = `${period.label} · ${scopeText} · as of ${formatAsOf(forecast.asOf)}`;
  const ok = forecast.status === "ok";
  const next = forecast.projection[0];

  const actual = forecast.history.map((point) => Number(point.value));
  const fitted = forecast.history.map((point) => Number(point.fitted));
  const projected = forecast.projection.map((point) => Number(point.value));
  const lastActual = actual.length > 0 ? actual[actual.length - 1]! : 0;
  const chartPoints = [...fitted, ...projected];
  const chartComparison = [...actual, ...projected.map(() => lastActual)];
  const chartLabels = [
    ...forecast.history.map((point) => point.period),
    ...forecast.projection.map((point) => point.period),
  ];

  const projectionColumns = [
    { key: "period", header: "Period" },
    { key: "value", header: "Projected", align: "right" as const },
    { key: "lower", header: "Lower (−1σ)", align: "right" as const },
    { key: "upper", header: "Upper (+1σ)", align: "right" as const },
  ];
  const projectionRows = forecast.projection.map((point) => ({
    period: point.period,
    value: formatMetricValue(point.value, forecast.unit),
    lower: formatMetricValue(point.lower, forecast.unit),
    upper: formatMetricValue(point.upper, forecast.unit),
  }));

  const metricHref = (nextMetric: string): string =>
    `/insights/forecast?metric=${nextMetric}&grain=${grain}&historyPeriods=${historyPeriods}&horizonPeriods=${horizonPeriods}`;
  const grainHref = (nextGrain: string): string =>
    `/insights/forecast?metric=${metric}&grain=${nextGrain}&historyPeriods=${historyPeriods}&horizonPeriods=${horizonPeriods}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <style>{pageCss}</style>
      <PageHeader
        title="Forecast"
        scope="Insights"
        description={`An advisory projection of ${forecast.metricLabel.toLowerCase()} from a fitted historical trend — a model, not a recorded fact.`}
      />

      <Tabs
        items={METRIC_OPTIONS.map((option) => ({
          label: metricLabel(option),
          href: metricHref(option),
          active: option === metric,
        }))}
        ariaLabel="Forecast metric"
      />
      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: grainHref(option),
          active: option === grain,
        }))}
        ariaLabel="Forecast period grain"
      />

      {ok ? (
        <>
          <section
            aria-label="Key figures"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: spacing[4],
            }}
          >
            <KpiCard
              label={`Projected ${forecast.metricLabel.toLowerCase()}`}
              value={next === undefined ? "—" : formatMetricValue(next.value, forecast.unit)}
              meta={`${next?.period ?? "—"} · ${meta}`}
              comparison={
                next === undefined
                  ? undefined
                  : `band ${formatMetricValue(next.lower, forecast.unit)} – ${formatMetricValue(next.upper, forecast.unit)}`
              }
            />
            <KpiCard
              label="Backtested accuracy (MAPE)"
              value={
                forecast.accuracy?.mape == null ? "n/a" : formatFractionPct(forecast.accuracy.mape)
              }
              meta={`in-sample over ${forecast.accuracy?.points ?? 0} points · lower is better`}
            />
          </section>

          <SectionCard
            title={`History and projection of ${forecast.metricLabel.toLowerCase()}`}
            meta={`${forecast.history.length} history periods + ${forecast.projection.length} projected · ${meta}`}
          >
            <div className="forecast-chart">
              <LineChart
                points={chartPoints}
                comparisonPoints={chartComparison}
                xLabels={chartLabels}
                highlightIndex={forecast.history.length}
                width={820}
                height={250}
                ariaLabel={`How is ${forecast.metricLabel.toLowerCase()} projected to move? Fitted history and projection from ${chartLabels[0] ?? "—"} to ${chartLabels[chartLabels.length - 1] ?? "—"}.`}
                summary={`The pale line is the observed history (held flat after the last period); the accent line is the least-squares trend fitted over the history and extended into the projection. The projection table below gives the projected value and its ±1 residual-σ band.`}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Projection"
            meta={`${forecast.projection.length} periods · model, not fact`}
          >
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <DataTable
                caption={`Projected ${forecast.metricLabel.toLowerCase()} with its ±1 residual standard deviation band`}
                columns={projectionColumns}
                rows={projectionRows}
              />
            </div>
          </SectionCard>

          <p style={paragraph}>
            Method: {forecast.method}. Slope per period {forecast.model?.slopePerPeriod}, intercept{" "}
            {forecast.model?.intercept}, band {forecast.model?.confidence.bandScale} (
            {forecast.model?.confidence.method}). Accuracy: {forecast.accuracy?.methodNote}.{" "}
            {forecast.notes.join(" · ")}.
          </p>
        </>
      ) : (
        <>
          <Alert tone="warning" title="Insufficient history for an honest forecast">
            {forecast.insufficient?.reason}. The method is {forecast.method}; no projection is shown
            rather than fitting a number to too little history.
          </Alert>
          <p style={paragraph}>{forecast.notes.join(" · ")}.</p>
        </>
      )}

      <SectionCard
        title="Suggestions"
        meta={`${suggestions.suggestions.length} ${suggestions.suggestions.length === 1 ? "advisory" : "advisories"} · advisory only, human approval`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing[3], flexWrap: "wrap" }}>
            <StatusPill tone="info">Advisory only</StatusPill>
            <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
              {suggestions.postureNote}
            </span>
          </div>
          {suggestions.suggestions.length === 0 ? (
            <EmptyState title="No advisories fired">
              No rule fired for {period.label}: the metrics are within their flat bands, no entity
              is more than 25% below its peer median, and no product has a negative or thin
              contribution.
            </EmptyState>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: spacing[4],
              }}
            >
              {suggestions.suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.ruleId}-${index}`}
                  style={{
                    border: `1px solid ${color.border.subtle}`,
                    borderRadius: radius.lg,
                    padding: spacing[4],
                    display: "flex",
                    flexDirection: "column",
                    gap: spacing[2],
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing[3],
                      flexWrap: "wrap",
                    }}
                  >
                    <StatusPill tone={severityTone(suggestion.severity)}>
                      {SEVERITY_LABELS[suggestion.severity]}
                    </StatusPill>
                    <strong style={{ fontSize: typography.fontSize.sm, color: color.ink.primary }}>
                      {suggestion.title}
                    </strong>
                    <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
                      rule {suggestion.ruleId}
                    </span>
                  </div>
                  <span style={{ fontSize: typography.fontSize.sm, color: color.text.muted }}>
                    Evidence:{" "}
                    {suggestion.evidence.map((item) => `${item.label} ${item.value}`).join(" · ")}
                  </span>
                  <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
                    Next: {suggestion.action}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
            {suggestions.evaluated.map((rule) => `${rule.ruleId} (${rule.fired})`).join(" · ")}
          </span>
        </div>
      </SectionCard>

      {/* Forecast-vs-actual tracking (DEC-011/DEC-138): a recorded snapshot
          compared against the posted actuals of each completed period, with an
          out-of-sample MAPE. `insufficient_history` and `no_snapshot` are shown
          honestly rather than as a fabricated figure. */}
      <SectionCard
        title="Forecast tracking"
        meta={
          tracking === null
            ? "projected vs actual · per location"
            : `${grainLabel(tracking.grain)} · ${formatCompletedPeriods(tracking.completedPeriods)} · as of ${formatAsOf(tracking.asOf)}`
        }
      >
        {tracking === null ? (
          <Alert tone="info" title="Tracking is per location">
            A snapshot records one location or the whole organization, so tracking cannot be shown
            for a multi-location scope. Open this screen for a single accessible location, or ask an
            owner to record an organization-wide snapshot.
          </Alert>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: spacing[3], flexWrap: "wrap" }}
            >
              <StatusPill tone={trackingStatusTone(tracking.status)}>
                {trackingStatusLabel(tracking.status)}
              </StatusPill>
              <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
                {grainLabel(tracking.grain)} · model {tracking.model ?? "n/a"} · snapshot as of{" "}
                {tracking.snapshotAsOf === null ? "n/a" : formatAsOf(tracking.snapshotAsOf)}
                {tracking.snapshotGeneratedAt === null
                  ? ""
                  : ` · recorded ${formatAsOf(tracking.snapshotGeneratedAt)}`}
              </span>
            </div>

            {tracking.status !== "ok" ? (
              <Alert
                tone={tracking.status === "no_snapshot" ? "info" : "warning"}
                title={trackingStatusLabel(tracking.status)}
              >
                {tracking.reason ?? "Accuracy is not reported for this state."}
              </Alert>
            ) : null}

            {tracking.periods.length > 0 ? (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <DataTable
                  caption={`Projected against posted actuals for each completed period (${grainLabel(tracking.grain).toLowerCase()}). The projected column is a model figure; the actual column is posted data.`}
                  columns={[
                    { key: "period", header: "Period" },
                    { key: "projected", header: "Projected (model)", align: "right" as const },
                    { key: "actual", header: "Actual (posted)", align: "right" as const },
                    { key: "error", header: "Abs. error", align: "right" as const },
                    { key: "pctError", header: "% error", align: "right" as const },
                  ]}
                  rows={tracking.periods.map((point) => ({
                    period: point.period,
                    projected: formatMetricValue(point.projected, tracking.unit),
                    actual: formatMetricValue(point.actual, tracking.unit),
                    error:
                      point.absoluteError === null
                        ? "n/a"
                        : formatMetricValue(point.absoluteError, tracking.unit),
                    pctError: formatTrackingError(point.percentageError),
                  }))}
                />
              </div>
            ) : null}

            <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
              {tracking.status === "ok"
                ? `Out-of-sample accuracy (MAPE): ${formatAccuracy(tracking.accuracy?.mape ?? null)} over ${tracking.accuracy?.periods ?? 0} completed periods with a non-zero actual — lower is better. ${tracking.accuracy?.methodNote ?? ""}`
                : `Accuracy withheld: ${tracking.reason ?? "not reported"}.`}
            </span>

            {tracking.overrides.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
                <strong style={{ fontSize: typography.fontSize.sm, color: color.ink.primary }}>
                  Recorded overrides (advisory, append-only)
                </strong>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: spacing[2],
                  }}
                >
                  {tracking.overrides.map((override) => (
                    <li
                      key={override.id}
                      style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}
                    >
                      <strong>{override.period}</strong> — {override.reason}{" "}
                      <span style={{ color: color.text.muted }}>
                        (recorded {formatAsOf(override.recordedAt)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {canWriteTracking ? (
              <ForecastTrackingActions
                metric={tracking.metric}
                grain={tracking.grain}
                grainText={grainLabel(tracking.grain)}
                locationId={tracking.scope.locationId}
                channelId={tracking.scope.channelId}
                snapshotId={tracking.snapshotId}
                periods={tracking.periods.map((point) => point.period)}
              />
            ) : null}

            <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
              {tracking.notes.join(" · ")}
            </span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
