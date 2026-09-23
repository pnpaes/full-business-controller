import {
  SALES_REPORT_CURRENCY,
  buildSalesReport,
  createPostgresReportingStore,
} from "@aquarela/application";
import {
  DonutChart,
  EmptyState,
  LineChart,
  PageHeader,
  SectionCard,
  Tabs,
  breakpoint,
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
import { LocationComparisonTable, MetricBand } from "./home-modules";
import {
  GRAIN_LABELS,
  GRAIN_OPTIONS,
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
  maxWidth: "70ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.ink.secondary,
} as const;

/**
 * Page-scoped responsive composition rules (brief §18) — the only styling
 * inline styles cannot express. Token-derived, prefixed `mh-`, and rendered
 * once below. Composition changes, not shrinkage: the focal module reflows
 * headline → chart → donut, the metric band runs 4-up → 2×2 → stacked, the
 * analysis row collapses to one column and the comparison table drops its
 * ingredient-cost column on phones.
 */
const pageCss = `
.mh-focal {
  display: grid;
  grid-template-columns: minmax(230px, 0.9fr) minmax(0, 2.1fr) minmax(170px, 0.8fr);
  grid-template-areas: "headline chart donut";
  gap: ${spacing[8]}px;
  align-items: center;
}
.mh-focal-chart { min-width: 0; }
.mh-focal-chart svg { width: 100%; height: auto; }
.mh-band { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mh-band-cell + .mh-band-cell {
  border-left: 1px solid ${color.border.subtle};
  padding-left: ${spacing[5]}px;
}
.mh-analysis {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: ${spacing[6]}px;
  align-items: start;
}
@media (max-width: ${breakpoint.desktop - 1}px) {
  .mh-focal {
    grid-template-columns: minmax(0, 1fr) minmax(150px, 0.6fr);
    grid-template-areas: "headline donut" "chart chart";
    gap: ${spacing[6]}px;
  }
  .mh-band { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: ${spacing[5]}px; }
  .mh-band-cell:nth-child(3) { border-left: 0; padding-left: 0; }
  .mh-analysis { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: ${breakpoint.tablet - 1}px) {
  .mh-focal {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "headline" "donut" "chart";
  }
  .mh-band { grid-template-columns: minmax(0, 1fr); }
  .mh-band-cell + .mh-band-cell {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid ${color.border.subtle};
    padding-top: ${spacing[4]}px;
  }
  .mh-col-cost { display: none; }
}
`;

/**
 * The drill-down href for one location group (`RPT-002`): the existing
 * records route with the report's window and the group's location filter —
 * the same contract the Insights report page uses; no new route.
 */
function locationRecordsHref(
  period: { readonly from: string; readonly to: string },
  grain: string,
  locationId: string,
): string {
  const params = new URLSearchParams({
    from: period.from,
    to: period.to,
    grain,
    locationId,
  });
  return `/api/v1/reports/sales/records?${params.toString()}`;
}

/**
 * Owner/GM home (`08_UI_UX.md` §8.2, §8.4; `RPT-001`, `RPT-003`, `FND-006`).
 * Server component: reads the same application service the reporting API uses
 * (`buildSalesReport` over `createPostgresReportingStore`) rather than an HTTP
 * round-trip, so the screen and the API cannot drift.
 *
 * Composition (brief §5/§8, DEC-120): one dominant focal module carrying the
 * period's management question — the net-sales headline, the daily net-sales
 * line and the contribution-margin proportion — followed by the period
 * measures as one analytical band, then the location comparison table and the
 * exception queue as a two-panel analysis row. No uniform card grid.
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
  const trendPoints = sparklinePoints(trend.groups);
  const trendLabels = trend.groups.map((group) => group.periodBucket.slice(5));
  const marginPct = report.totals.contributionMarginPct;
  const showDonut = hasData && marginPct !== null && Number(report.totals.netSales) > 0;

  const bandItems = [
    { label: "Units", value: hasData ? formatQuantity(report.totals.units) : "—" },
    { label: "Transactions", value: hasData ? String(report.totals.transactions) : "—" },
    {
      label: "Ingredient cost",
      value: hasData
        ? `${formatMoney(report.totals.ingredientCost)} ${SALES_REPORT_CURRENCY}`
        : "—",
    },
    {
      label: "Contribution before labour",
      value: hasData
        ? `${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`
        : "—",
      note: hasData
        ? `margin ${formatPct(marginPct)} · excludes direct labour, channel fees and overhead`
        : undefined,
    },
  ];

  const comparisonRows = report.groups.map((group) => ({
    location: group.label,
    href: group.locationId === null ? null : locationRecordsHref(period, grain, group.locationId),
    netSales: `${formatMoney(group.netSales)} ${SALES_REPORT_CURRENCY}`,
    ingredientCost: `${formatMoney(group.ingredientCost)} ${SALES_REPORT_CURRENCY}`,
    contribution: `${formatMoney(group.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`,
    margin: formatPct(group.contributionMarginPct),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />

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

      {/* Focal module: the period's main management question, with the
          headline figure, the daily trend and the margin proportion. */}
      <SectionCard
        title="Is net sales trending up day over day?"
        meta={hasData ? meta : `${period.label} · ${scopeLabel(report.scope)} · no data`}
      >
        {hasData ? (
          <div className="mh-focal">
            <div style={{ gridArea: "headline", minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.medium,
                  color: color.ink.secondary,
                }}
              >
                Net sales
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: spacing[1],
                  fontSize: typography.fontSize["5xl"],
                  fontWeight: typography.fontWeight.light,
                  lineHeight: typography.lineHeight.display,
                  letterSpacing: "-0.01em",
                  fontVariantNumeric: typography.fontVariantNumeric.tabular,
                  color: color.ink.primary,
                }}
              >
                {`${formatMoney(report.totals.netSales)} ${SALES_REPORT_CURRENCY}`}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: spacing[2],
                  fontSize: typography.fontSize.xs,
                  lineHeight: typography.lineHeight.normal,
                  color: color.ink.tertiary,
                }}
              >
                {meta}
              </span>
            </div>
            <div className="mh-focal-chart" style={{ gridArea: "chart" }}>
              <LineChart
                points={trendPoints}
                xLabels={trendLabels}
                highlightIndex={trendPoints.length - 1}
                width={720}
                height={230}
                ariaLabel={`Is net sales trending up day over day? Daily net sales for ${period.label}, ${scopeLabel(report.scope)}.`}
                summary={`Daily net sales across ${trendPoints.length} ${trendPoints.length === 1 ? "day" : "days"} of ${period.label}, from the same posted sales lines as the figures on this page.`}
              />
            </div>
            {showDonut ? (
              <div style={{ gridArea: "donut", justifySelf: "center" }}>
                <DonutChart
                  value={Number(report.totals.contributionBeforeLabour)}
                  total={Number(report.totals.netSales)}
                  centerLabel={formatPct(marginPct)}
                  centerCaption="contribution margin"
                  size={150}
                  ariaLabel={`What share of net sales survives ingredient cost? Contribution margin ${formatPct(marginPct)} for ${period.label}.`}
                  summary={`Contribution of ${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY} against net sales of ${formatMoney(report.totals.netSales)} ${SALES_REPORT_CURRENCY}, before direct labour, channel fees and allocated overhead.`}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No sales in this period">
            No posted sales lines fall in {period.label}. Import a sales file and post theoretical
            consumption, then this view fills in.
          </EmptyState>
        )}
      </SectionCard>

      {/* The period measures as one analytical band, not four equal cards. */}
      <SectionCard title="Period measures" meta={hasData ? meta : `${meta} · no data yet`}>
        <MetricBand items={bandItems} />
      </SectionCard>

      <div className="mh-analysis">
        <SectionCard
          title="Location comparison"
          meta={`Totals only · normalized efficiency measures are undefined and deferred (RPT-003) · ${scopeLabel(report.scope)}`}
        >
          {hasData ? (
            <LocationComparisonTable
              caption="Sales totals by location for the selected period; each location drills into its records."
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
          title="Exceptions and approvals"
          meta="Decision queue · all locations · latest import cycle · no runs yet"
        >
          <EmptyState title="No exceptions yet">
            No exceptions yet — sales, counts and receipts populate this once imported. When data
            arrives, each warning will show its threshold, evidence, owner and next action.
          </EmptyState>
        </SectionCard>
      </div>

      <p style={paragraph}>
        Contribution is net sales minus the moving-average ingredient cost posted to the stock
        ledger. It excludes direct labour, channel fees and allocated overhead, which are not
        computable yet, so no full cost or gross margin is shown (DEC-063). The location comparison
        shows totals only; normalized efficiency measures are undefined and deferred (RPT-003).
      </p>
    </div>
  );
}
