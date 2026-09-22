import {
  SALES_REPORT_CURRENCY,
  buildSalesReport,
  createPostgresReportingStore,
} from "@aquarela/application";
import {
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  Sparkline,
  Tabs,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../lib/db";
import { resolveOrganization } from "../../lib/organization";
import { getServerSession } from "../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../app/api/v1/reports/access";
import {
  GRAIN_LABELS,
  GRAIN_OPTIONS,
  formatAsOf,
  formatMoney,
  formatPct,
  formatQuantity,
  isGrain,
  metaLine,
  periodForGrain,
  scopeLabel,
  sparklinePoints,
} from "./insights/reports/report-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Management home — Aquarela Business Control" };

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
  maxWidth: "60ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.text.muted,
} as const;

const comparisonColumns = [
  { key: "location", header: "Location" },
  { key: "netSales", header: "Net sales", align: "right" as const },
  { key: "ingredientCost", header: "Ingredient cost", align: "right" as const },
  { key: "contribution", header: "Contribution", align: "right" as const },
  { key: "margin", header: "Margin", align: "right" as const },
] as const;

/**
 * Owner/GM home (`08_UI_UX.md` §8.2, §8.4; `RPT-001`, `RPT-003`, `FND-006`).
 * Server component: reads the same application service the reporting API uses
 * (`buildSalesReport` over `createPostgresReportingStore`) rather than an HTTP
 * round-trip, so the screen and the API cannot drift.
 *
 * Every figure carries its period, scope and freshness (`FND-006`); the
 * contribution KPI is explicitly **before** direct labour, channel fees and
 * allocated overhead, which are not computable today, so no full cost or gross
 * margin is shown (`DEC-063`). The location comparison is **totals only** —
 * normalized efficiency measures are undefined and deferred (`RPT-003`). An
 * empty period shows honest empty states (`08:72`).
 *
 * Access: the reporting role set (owner / general_manager / location_manager /
 * finance / admin / analyst); a scoped caller is bounded to their locations. The
 * role gate is here because this page is the Owner/GM home — a `kitchen` /
 * `front_of_house` / `purchasing` caller gets an explicit "not available" state
 * rather than consolidated margin.
 */
export default async function ManagementHomePage({
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
        <PageHeader
          title="Management home"
          scope="Owner / GM · consolidated view"
          description="Sales, contribution and exception position across locations."
        />
        <EmptyState title="Not available for your role">
          The management home shows consolidated sales and contribution, which your role may not
          read. Ask an owner or general manager if you need access.
        </EmptyState>
      </div>
    );
  }

  const params = toSearchParams(await searchParams);
  const grainParam = params.get("grain")?.trim();
  const grain = grainParam !== undefined && isGrain(grainParam) ? grainParam : "month";
  const period = periodForGrain(grain, new Date());

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;
  const scopeFilter = locationIds === undefined ? {} : { locationIds };

  const report = await buildSalesReport(store, {
    organizationId,
    actorId: session.userId,
    from: period.from,
    to: period.to,
    grain,
    groupBy: "location",
    ...scopeFilter,
  });
  const trend = await buildSalesReport(store, {
    organizationId,
    actorId: session.userId,
    from: period.from,
    to: period.to,
    grain: "day",
    groupBy: "period",
    ...scopeFilter,
  });

  const hasData = report.totals.transactions > 0;
  const meta = metaLine(period, report.scope, report.asOf);
  const comparisonRows = report.groups.map((group) => ({
    location: group.label,
    netSales: `${formatMoney(group.netSales)} ${SALES_REPORT_CURRENCY}`,
    ingredientCost: `${formatMoney(group.ingredientCost)} ${SALES_REPORT_CURRENCY}`,
    contribution: `${formatMoney(group.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`,
    margin: formatPct(group.contributionMarginPct),
  }));
  const trendPoints = sparklinePoints(trend.groups);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Management home"
        scope="Owner / GM · consolidated view"
        description="Sales, contribution and exception position across locations. Figures appear once source data is imported and reconciled."
      />

      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: `/?grain=${option}`,
          active: option === grain,
        }))}
        ariaLabel="Reporting period grain"
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
          label="Net sales"
          value={hasData ? `${formatMoney(report.totals.netSales)} ${SALES_REPORT_CURRENCY}` : "—"}
          meta={meta}
        />
        <KpiCard
          label="Units"
          value={hasData ? formatQuantity(report.totals.units) : "—"}
          meta={meta}
        />
        <KpiCard
          label="Transactions"
          value={hasData ? String(report.totals.transactions) : "—"}
          meta={meta}
        />
        <KpiCard
          label="Contribution before labour"
          value={
            hasData
              ? `${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`
              : "—"
          }
          meta={`${meta} · margin ${formatPct(report.totals.contributionMarginPct)} · excludes direct labour, channel fees and overhead`}
        />
      </section>

      <SectionCard
        title="Location comparison"
        meta={`Totals only · normalized efficiency measures are undefined and deferred (RPT-003) · ${scopeLabel(report.scope)}`}
      >
        {hasData ? (
          <DataTable
            caption="Sales totals by location for the selected period"
            columns={[...comparisonColumns]}
            rows={comparisonRows}
          />
        ) : (
          <EmptyState title="No sales in this period">
            No posted sales lines fall in {period.label}. Import a sales file and post theoretical
            consumption, then this comparison fills in.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Trend"
        meta={
          hasData
            ? `Is net sales trending up day over day? · ${period.label} · as of ${formatAsOf(report.asOf)}`
            : "Is net sales trending up day over day? · no data"
        }
      >
        {hasData ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: spacing[3],
            }}
          >
            <Sparkline
              points={trendPoints}
              width={320}
              height={72}
              tone="berry"
              ariaLabel="Net sales per day for the selected period."
            />
            <p style={paragraph}>
              Daily net sales for {period.label}, from the same posted sales lines as the figures
              above.
            </p>
          </div>
        ) : (
          <EmptyState title="No trend to show">
            Daily net sales appear here once sales are imported and posted for the period.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Exceptions and approvals"
        meta="Decision queue · all locations · latest import cycle · no runs yet"
      >
        <EmptyState title="No exceptions yet">
          No exceptions yet — sales, counts and receipts populate this once imported. When data
          arrives, each warning will show its threshold, evidence, owner and next action.
        </EmptyState>
      </SectionCard>
    </div>
  );
}
