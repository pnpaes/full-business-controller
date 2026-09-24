import {
  computeTrends,
  createPostgresReportingStore,
  type TrendSeries,
} from "@aquarela/application";
import {
  DataTable,
  EmptyState,
  KpiCard,
  LineChart,
  PageHeader,
  SectionCard,
  StatusPill,
  Tabs,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../../api/v1/reports/access";
import {
  formatDirection,
  formatFlatBand,
  formatMetricValue,
  formatRelativeChange,
  isMetric,
  metricLabel,
  METRIC_OPTIONS,
} from "../analytics-labels";
import { GRAIN_LABELS, GRAIN_OPTIONS, formatAsOf, isGrain } from "../reports/report-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trends — Aquarela Business Control" };

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

/** The direction tone: up healthy, down danger, flat neutral. */
function directionTone(direction: "up" | "down" | "flat" | null) {
  if (direction === "up") return "success" as const;
  if (direction === "down") return "danger" as const;
  return "info" as const;
}

/**
 * Insights → Trends (`W6`): a period-over-period series for one metric, with the
 * direction, the absolute/relative change and the period, and the method and
 * flat band stated on the page. Server component: it calls the application
 * service directly, so the screen and the API cannot drift.
 *
 * Every figure carries its period, scope and freshness (`FND-006`); a period
 * whose metric is undefined shows "n/a" and is plotted at zero only in the
 * chart, with the exact figures in the table.
 */
export default async function InsightsTrendsPage({
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
        <PageHeader title="Trends" scope="Insights" description="Period-over-period trends." />
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
  const periodsParam = params.get("periods")?.trim();
  const periods =
    periodsParam !== undefined && /^\d+$/.test(periodsParam) ? Number(periodsParam) : 6;

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;

  const trend: TrendSeries = await computeTrends(store, {
    organizationId,
    metric,
    grain,
    periods: periods >= 1 && periods <= 60 ? periods : 6,
    ...(locationIds === undefined ? {} : { locationIds }),
  });

  const scopeText =
    trend.scope.locationIds === null
      ? "All locations"
      : `${trend.scope.locationIds.length} ${trend.scope.locationIds.length === 1 ? "location" : "locations"}`;
  const meta = `${trend.points[0]?.period ?? "—"} – ${trend.points[trend.points.length - 1]?.period ?? "—"} · ${scopeText} · as of ${formatAsOf(trend.asOf)}`;
  const latest = trend.points[trend.points.length - 1];
  const hasUndefined = trend.points.some((point) => point.value === null);
  const hasData = trend.points.some((point) => point.value !== null);

  const chartPoints = trend.points.map((point) => (point.value === null ? 0 : Number(point.value)));
  const chartLabels = trend.points.map((point) => point.period);

  const columns = [
    { key: "period", header: "Period" },
    { key: "value", header: trend.metricLabel, align: "right" as const },
    { key: "previous", header: "Previous", align: "right" as const },
    { key: "change", header: "Change", align: "right" as const },
    { key: "changePct", header: "Change %", align: "right" as const },
    { key: "direction", header: "Direction", align: "center" as const },
  ];
  const rows = trend.points.map((point) => ({
    period: point.period,
    value: formatMetricValue(point.value, trend.unit),
    previous: formatMetricValue(point.previousValue, trend.unit),
    change:
      point.absoluteChange === null ? "n/a" : formatMetricValue(point.absoluteChange, trend.unit),
    changePct: formatRelativeChange(point.relativeChange),
    direction: (
      <StatusPill tone={directionTone(point.direction)}>
        {formatDirection(point.direction)}
      </StatusPill>
    ),
  }));

  const metricHref = (nextMetric: string): string =>
    `/insights/trends?metric=${nextMetric}&grain=${grain}&periods=${periods}`;
  const grainHref = (nextGrain: string): string =>
    `/insights/trends?metric=${metric}&grain=${nextGrain}&periods=${periods}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Trends"
        scope="Insights"
        description={`Period-over-period ${trend.metricLabel.toLowerCase()}, with each period's comparison against the previous one, the change and a direction.`}
      />

      <Tabs
        items={METRIC_OPTIONS.map((option) => ({
          label: metricLabel(option),
          href: metricHref(option),
          active: option === metric,
        }))}
        ariaLabel="Trend metric"
      />
      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: grainHref(option),
          active: option === grain,
        }))}
        ariaLabel="Trend period grain"
      />

      <section
        aria-label="Key figures"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label={`Latest ${trend.metricLabel.toLowerCase()}`}
          value={latest === undefined ? "—" : formatMetricValue(latest.value, trend.unit)}
          {...(latest?.relativeChange == null
            ? {}
            : { delta: formatRelativeChange(latest.relativeChange) })}
          {...(latest?.direction == null ? {} : { trend: latest.direction })}
          meta={`${latest?.period ?? "—"} · ${meta}`}
          comparison={
            latest === undefined
              ? undefined
              : `previous ${formatMetricValue(latest.previousValue, trend.unit)}`
          }
        />
        <KpiCard
          label="Flat band"
          value={formatFlatBand(trend.flatBandFraction)}
          meta="a change inside the band reads as flat; outside it, the direction is the change's sign"
        />
      </section>

      <SectionCard
        title={`${trend.metricLabel} over time`}
        meta={`${trend.points.length} ${trend.points.length === 1 ? "period" : "periods"} · ${meta}`}
      >
        {hasData ? (
          <LineChart
            points={chartPoints}
            xLabels={chartLabels}
            highlightIndex={chartPoints.length - 1}
            width={760}
            height={240}
            ariaLabel={`How did ${trend.metricLabel.toLowerCase()} move period by period? ${trend.metricLabel} for ${meta}.`}
            summary={`${trend.metricLabel} across ${trend.points.length} periods (${chartLabels[0] ?? "—"} to ${chartLabels[chartLabels.length - 1] ?? "—"}). The table below gives the exact value, change and direction for every period.${
              hasUndefined
                ? " Periods with no computable value are plotted at zero in the chart; the table shows them as n/a."
                : ""
            }`}
          />
        ) : (
          <EmptyState title="No computable values in this window">
            No period in this window has a computable {trend.metricLabel.toLowerCase()}. Import and
            post the source data, then this series fills in.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Period by period" meta={`${trend.metricLabel} · ${meta}`}>
        <DataTable
          caption={`${trend.metricLabel} by period with the change and direction`}
          columns={columns}
          rows={rows}
        />
      </SectionCard>

      <p style={paragraph}>
        Method: {trend.method}. Flat band: {formatFlatBand(trend.flatBandFraction)}.{" "}
        {trend.notes.join(" · ")}.
      </p>
    </div>
  );
}
