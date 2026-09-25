import {
  BENCHMARK_METRICS,
  computeBenchmarks,
  createPostgresReportingStore,
  isBenchmarkMetric,
  type BenchmarkReport,
} from "@aquarela/application";
import {
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  ProgressBar,
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
  DIMENSION_LABELS,
  DIMENSION_OPTIONS,
  formatMetricValue,
  formatRatio,
  isDimension,
  metricLabel,
} from "../analytics-labels";
import {
  GRAIN_LABELS,
  GRAIN_OPTIONS,
  formatAsOf,
  isGrain,
  periodForGrain,
} from "../reports/report-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Benchmarks — Aquarela Business Control" };

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
 * Insights → Benchmarks (`W6`): each entity's value against the organization
 * aggregate and the peer median of the same dimension, ranked. The benchmark is
 * **internal only** — there is no external market data — and the page says so.
 * Server component: it calls the application service directly, so the screen and
 * the API cannot drift.
 */
export default async function InsightsBenchmarksPage({
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
        <PageHeader title="Benchmarks" scope="Insights" description="Internal benchmarks." />
        <EmptyState title="Not available for your role">
          The analytics reads are not readable by your role.
        </EmptyState>
      </div>
    );
  }

  const params = toSearchParams(await searchParams);
  const dimensionParam = params.get("dimension")?.trim();
  const dimension =
    dimensionParam !== undefined && isDimension(dimensionParam) ? dimensionParam : "location";
  const metricParam = params.get("metric")?.trim();
  const metric =
    metricParam !== undefined && isBenchmarkMetric(metricParam) ? metricParam : "revenue";
  const grainParam = params.get("grain")?.trim();
  const grain = grainParam !== undefined && isGrain(grainParam) ? grainParam : "month";
  const period = periodForGrain(grain, new Date());

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;

  const report: BenchmarkReport = await computeBenchmarks(store, {
    organizationId,
    dimension,
    metric,
    period: { from: period.from, to: period.to },
    ...(locationIds === undefined ? {} : { locationIds }),
  });

  const scopeText =
    report.scope.locationIds === null
      ? "All locations"
      : `${report.scope.locationIds.length} ${report.scope.locationIds.length === 1 ? "location" : "locations"}`;
  const meta = `${period.label} · ${scopeText} · as of ${formatAsOf(report.asOf)}`;
  const hasData = report.entities.length > 0;

  const columns = [
    { key: "rank", header: "Rank", align: "right" as const },
    { key: "entity", header: report.dimensionLabel },
    { key: "value", header: report.metricLabel, align: "right" as const },
    { key: "ratioOrg", header: "vs organization", align: "right" as const },
    { key: "ratioMedian", header: "vs peer median", align: "right" as const },
    { key: "meets", header: "At/above median", align: "center" as const },
  ];
  const rows = report.entities.map((entity) => {
    const ratio = entity.ratioToPeerMedian;
    const tone =
      entity.meetsPeerMedian === true
        ? "success"
        : entity.meetsPeerMedian === false
          ? "warning"
          : "info";
    return {
      rank: entity.rank === null ? "—" : String(entity.rank),
      entity: entity.isUnmapped ? `${entity.label} (unmapped)` : entity.label,
      value: formatMetricValue(entity.value, report.unit),
      ratioOrg: formatRatio(entity.ratioToOrganization),
      ratioMedian:
        ratio === null ? (
          "n/a"
        ) : (
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing[1],
              alignItems: "flex-end",
            }}
          >
            <span>{formatRatio(ratio)}</span>
            <span style={{ width: 96 }}>
              <ProgressBar value={Number(ratio)} max={2} tone={tone} />
            </span>
          </span>
        ),
      meets:
        entity.meetsPeerMedian === null ? (
          <StatusPill tone="info">n/a</StatusPill>
        ) : (
          <StatusPill tone={tone}>{entity.meetsPeerMedian ? "Yes" : "No"}</StatusPill>
        ),
    };
  });

  const dimensionHref = (nextDimension: string): string =>
    `/insights/benchmarks?dimension=${nextDimension}&metric=${metric}&grain=${grain}`;
  const metricHref = (nextMetric: string): string =>
    `/insights/benchmarks?dimension=${dimension}&metric=${nextMetric}&grain=${grain}`;
  const grainHref = (nextGrain: string): string =>
    `/insights/benchmarks?dimension=${dimension}&metric=${metric}&grain=${nextGrain}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Benchmarks"
        scope="Insights"
        description={`Each ${report.dimensionLabel.toLowerCase()}'s ${report.metricLabel.toLowerCase()} against the organization aggregate and the peer median of the same dimension.`}
      />

      <Tabs
        items={DIMENSION_OPTIONS.map((option) => ({
          label: DIMENSION_LABELS[option],
          href: dimensionHref(option),
          active: option === dimension,
        }))}
        ariaLabel="Benchmark dimension"
      />
      <Tabs
        items={BENCHMARK_METRICS.map((option) => ({
          label: metricLabel(option),
          href: metricHref(option),
          active: option === metric,
        }))}
        ariaLabel="Benchmark metric"
      />
      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: grainHref(option),
          active: option === grain,
        }))}
        ariaLabel="Benchmark period grain"
      />

      <div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
        <StatusPill tone="info">Internal benchmark</StatusPill>
        <p style={paragraph}>{report.basisNote}.</p>
      </div>

      <section
        aria-label="Key figures"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Organization aggregate"
          value={formatMetricValue(report.organizationAggregate, report.unit)}
          meta={meta}
        />
        <KpiCard
          label="Peer median"
          value={formatMetricValue(report.peerMedian, report.unit)}
          meta={`median across the ${report.dimensionLabel.toLowerCase()}s in scope · ${meta}`}
        />
      </section>

      <SectionCard
        title={`Ranked by ${report.metricLabel.toLowerCase()}`}
        meta={`${report.entities.length} ${report.entities.length === 1 ? report.dimensionLabel.toLowerCase() : `${report.dimensionLabel.toLowerCase()}s`} · ${meta}`}
      >
        {hasData ? (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <DataTable
              caption={`${report.metricLabel} by ${report.dimensionLabel.toLowerCase()}, against the organization aggregate and the peer median`}
              columns={columns}
              rows={rows}
              stickyHeader
            />
          </div>
        ) : (
          <EmptyState title="No entities in this period">
            No posted sales line in {period.label} resolved to a{" "}
            {report.dimensionLabel.toLowerCase()}, so there is nothing to benchmark.
          </EmptyState>
        )}
      </SectionCard>

      <p style={paragraph}>
        {report.notes.join(" · ")}. The rank is standard competition ranking (1, 2, 2, 4) over the
        mapped entities only; a ratio above 100% means the entity is above the organization
        aggregate or the median. The bar shows the entity&apos;s value against twice the peer
        median.
      </p>
    </div>
  );
}
