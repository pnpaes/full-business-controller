import {
  SALES_REPORT_CURRENCY,
  buildMenuEngineeringReport,
  buildOperationsReport,
  buildSalesReport,
  computeForecastTracking,
  createPostgresForecastStore,
  createPostgresReportingStore,
} from "@aquarela/application";
import {
  Breadcrumbs,
  DonutChart,
  EmptyState,
  LineChart,
  PageHeader,
  SectionCard,
  StatusPill,
  breakpoint,
  color,
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../api/v1/reports/access";
import { MetricBand } from "../home-modules";
import {
  formatAccuracy,
  grainLabel,
  trackingStatusLabel,
  trackingStatusTone,
} from "./forecast-tracking-labels";
import {
  formatAsOf,
  formatMoney,
  formatPct,
  formatQuantity,
  metaLine,
  scopeLabel,
  sparklinePoints,
} from "./reports/report-labels";
import { topByContribution } from "./landing-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights — Aquarela Business Control" };

const paragraph = {
  margin: 0,
  maxWidth: "70ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.ink.secondary,
} as const;

const actionLink = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: geometry.controlHeight.sm,
  color: color.accent.deep,
  fontWeight: typography.fontWeight.semibold,
  fontSize: typography.fontSize.sm,
} as const;

/**
 * Page-scoped responsive composition rules (brief §18) — the only styling
 * inline styles cannot express. Token-derived, prefixed `in-`. The `mh-band`
 * rules are the class contract `MetricBand` (home-modules.tsx) renders
 * against; they are re-declared here because each page owns its style block.
 * Composition changes, not shrinkage: the focal module reflows
 * headline → chart → donut, the metric band runs 4-up → 2×2 → stacked, and
 * the preview/planned rows collapse to one column.
 */
const pageCss = `
.in-focal {
  display: grid;
  grid-template-columns: minmax(230px, 0.9fr) minmax(0, 2.1fr) minmax(170px, 0.8fr);
  grid-template-areas: "headline chart donut";
  gap: ${spacing[8]}px;
  align-items: center;
}
.in-focal-chart { min-width: 0; }
.in-focal-chart svg { width: 100%; height: auto; }
.mh-band { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mh-band-cell + .mh-band-cell {
  border-left: 1px solid ${color.border.subtle};
  padding-left: ${spacing[5]}px;
}
.in-previews, .in-planned {
  display: grid;
  gap: ${spacing[6]}px;
  align-items: start;
}
.in-previews { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.in-planned { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: ${breakpoint.desktop - 1}px) {
  .in-focal {
    grid-template-columns: minmax(0, 1fr) minmax(150px, 0.6fr);
    grid-template-areas: "headline donut" "chart chart";
    gap: ${spacing[6]}px;
  }
  .mh-band { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: ${spacing[5]}px; }
  .mh-band-cell:nth-child(3) { border-left: 0; padding-left: 0; }
  .in-previews { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: ${breakpoint.tablet - 1}px) {
  .in-focal {
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
  .in-planned { grid-template-columns: minmax(0, 1fr); }
}
/* Coarse pointers keep the 44px touch target on the card-header action links,
 * whose resting height is the 32px control height (DEC-129 keeps both). The
 * global rule in uiGlobalCss only reaches .aquarela-btn/.aquarela-field,
 * so a page-scoped class is required here. */
@media (pointer: coarse) {
  .in-action-link {
    min-height: ${geometry.touchTarget}px !important; /* inline styles win otherwise */
  }
}
`;

/**
 * Insights landing (`08_UI_UX.md` §8.3, brief §5/§8, DEC-120): an overview
 * that surfaces the aggregates the three live child reports already compute —
 * not a link list. Server component: it calls the same application services
 * the children call (`buildSalesReport`, `buildMenuEngineeringReport`,
 * `buildOperationsReport` over `createPostgresReportingStore`), so the landing
 * and the child screens cannot drift. No new query, route or dependency.
 *
 * Composition (brief §8): one focal module carrying the period's headline
 * analytical story (contribution before labour against net sales, with the
 * daily net-sales line), then the period measures as one grouped band, then
 * compact preview panels — one per child report, each with a real figure and
 * a link into it. Competitors is now a live preview linking into the reviewed
 * observation register (`DEC-126`), and forecast tracking is live (`DEC-138`):
 * projected-versus-actual over recorded snapshots, honest about `no_snapshot`
 * and `insufficient_history` rather than charting a placeholder figure.
 *
 * Every figure carries its period, scope and freshness (`08_UI_UX.md` §8.4,
 * `FND-006`). Contribution is **before** direct labour, channel fees and
 * allocated overhead (`DEC-063`); the landing reads the current month to date.
 * Role gating mirrors the children exactly (`SALES_REPORT_READ_ROLES`).
 */
export default async function InsightsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }
  const access = await loadReportingAccess(session.userId);
  if (!isReportingAuthorized(access, SALES_REPORT_READ_ROLES)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
        <PageHeader
          title="Insights"
          scope="Aquarela Business Control"
          description="Sales, menu-engineering and operations reporting."
        />
        <EmptyState title="Not available for your role">
          The insight reports are not readable by your role. Ask an owner or general manager if you
          need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;
  const scopeFilter = locationIds === undefined ? {} : { locationIds };
  const now = new Date();
  // The landing is fixed at the current month to date; the child screens own
  // the grain tabs. The meta lines state the window explicitly (§8.4).
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const period = {
    from: monthStart,
    to: now.toISOString(),
    label: `${monthStart.slice(0, 7)} month-to-date`,
  };

  const report = await buildSalesReport(store, {
    organizationId,
    actorId: session.userId,
    from: period.from,
    to: period.to,
    grain: "month",
    groupBy: "category",
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
  const menu = await buildMenuEngineeringReport(store, {
    organizationId,
    from: period.from,
    to: period.to,
    grain: "month",
    ...scopeFilter,
  });
  const operations = await buildOperationsReport(store, {
    organizationId,
    from: period.from,
    to: period.to,
    grain: "month",
    ...scopeFilter,
  });

  const meta = metaLine(period, report.scope, report.asOf);
  const hasSales = report.totals.transactions > 0;
  const marginPct = report.totals.contributionMarginPct;
  const showDonut = hasSales && marginPct !== null && Number(report.totals.netSales) > 0;
  const trendPoints = sparklinePoints(trend.groups);
  const trendLabels = trend.groups.map((group) => group.periodBucket.slice(5));

  const topCategories = topByContribution(report.groups, 3);
  const topCategory = topCategories[0];
  const menuRows = menu.rows.length;
  const popularityHigh = menu.rows.filter((row) => row.popularityHigh).length;
  const contributionHigh = menu.rows.filter((row) => row.contributionHigh).length;
  const hasStockValue = operations.stockValue.rows.length > 0;
  const hasWaste = operations.waste.rows.length > 0;
  const hasProduction = operations.production.rows.length > 0;
  const currency = operations.currency;

  // Forecast-vs-actual tracking (DEC-011/DEC-138): a recorded snapshot compared
  // with posted actuals. A snapshot records one location or the whole
  // organization, so a multi-location caller is told why it is not shown rather
  // than given an out-of-scope aggregate.
  const trackingLocationId = access.locationIds.length === 1 ? access.locationIds[0] : undefined;
  const tracking =
    access.locationIds.length <= 1
      ? await computeForecastTracking(createPostgresForecastStore(getDb().db), {
          organizationId,
          metric: "revenue",
          grain: "day_location",
          ...(trackingLocationId === undefined ? {} : { locationId: trackingLocationId }),
        })
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />

      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        <Breadcrumbs items={[{ label: "Management home", href: "/" }, { label: "Insights" }]} />
        <PageHeader
          title="Insights"
          scope="Aquarela Business Control"
          description="What the period sold, what it contributed, and how stock, production and waste behaved — with a path into each full report."
        />
      </div>

      {/* Focal module: the period's headline analytical story. */}
      <SectionCard
        title="How much of net sales survives ingredient cost?"
        meta={hasSales ? meta : `${period.label} · ${scopeLabel(report.scope)} · no data`}
      >
        {hasSales ? (
          <div className="in-focal">
            <div style={{ gridArea: "headline", minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.medium,
                  color: color.ink.secondary,
                }}
              >
                Contribution before labour
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
                {`${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`}
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
                {meta} · excludes direct labour, channel fees and allocated overhead
              </span>
            </div>
            <div className="in-focal-chart" style={{ gridArea: "chart" }}>
              <LineChart
                points={trendPoints}
                xLabels={trendLabels}
                highlightIndex={trendPoints.length - 1}
                width={720}
                height={230}
                ariaLabel={`How did net sales move day by day? Daily net sales for ${period.label}, ${scopeLabel(report.scope)}.`}
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
            consumption, then this overview fills in.
          </EmptyState>
        )}
      </SectionCard>

      {/* The period measures as one grouped band, not four equal cards. */}
      <SectionCard title="Period measures" meta={hasSales ? meta : `${meta} · no data yet`}>
        <MetricBand
          items={[
            {
              label: "Net sales",
              value: hasSales
                ? `${formatMoney(report.totals.netSales)} ${SALES_REPORT_CURRENCY}`
                : "—",
            },
            { label: "Units", value: hasSales ? formatQuantity(report.totals.units) : "—" },
            {
              label: "Ingredient cost",
              value: hasSales
                ? `${formatMoney(report.totals.ingredientCost)} ${SALES_REPORT_CURRENCY}`
                : "—",
            },
            {
              label: "Contribution before labour",
              value: hasSales
                ? `${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`
                : "—",
              note: hasSales ? `margin ${formatPct(marginPct)}` : undefined,
            },
          ]}
        />
      </SectionCard>

      {/* Compact previews: one panel per live child report, each with a real
          figure and a link into the full screen. */}
      <div className="in-previews">
        <SectionCard
          title="Sales & margin report"
          meta={`RPT-001 · ${meta}`}
          actions={
            <a href="/insights/reports" className="in-action-link" style={actionLink}>
              Open reports
            </a>
          }
        >
          {hasSales && topCategory !== undefined ? (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
              <span
                style={{
                  fontSize: typography.fontSize["2xl"],
                  fontWeight: typography.fontWeight.regular,
                  lineHeight: typography.lineHeight.tight,
                  fontVariantNumeric: typography.fontVariantNumeric.tabular,
                  color: color.ink.primary,
                }}
              >
                {`${formatMoney(topCategory.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`}
              </span>
              <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
                contribution from {topCategory.label}, the leading of {report.groups.length}{" "}
                {report.groups.length === 1 ? "category" : "categories"} · margin{" "}
                {formatPct(topCategory.contributionMarginPct)}
              </span>
              <span style={{ fontSize: typography.fontSize.xs, color: color.ink.tertiary }}>
                {topCategories
                  .slice(1)
                  .map((group) => `${group.label} ${formatMoney(group.contributionBeforeLabour)}`)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <EmptyState title="No category figures yet">
              No posted sales lines fall in {period.label}, so no category contributes yet.
            </EmptyState>
          )}
        </SectionCard>

        <SectionCard
          title="Menu engineering"
          meta={`RPT-005 · ${meta}`}
          actions={
            <a href="/insights/menu-engineering" className="in-action-link" style={actionLink}>
              Open matrix
            </a>
          }
        >
          {menuRows > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
              <span
                style={{
                  fontSize: typography.fontSize["2xl"],
                  fontWeight: typography.fontWeight.regular,
                  lineHeight: typography.lineHeight.tight,
                  fontVariantNumeric: typography.fontVariantNumeric.tabular,
                  color: color.ink.primary,
                }}
              >
                {menu.truncated ? `${menuRows}+` : menuRows}
              </span>
              <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
                products classified · {popularityHigh} high on popularity, {contributionHigh} high
                on contribution before labour/fees
              </span>
              <span style={{ fontSize: typography.fontSize.xs, color: color.ink.tertiary }}>
                computed median thresholds, never configured targets
              </span>
            </div>
          ) : (
            <EmptyState title="No classifiable products">
              No posted sales line in {period.label} resolved to a product variant, so there is
              nothing to classify against the thresholds.
            </EmptyState>
          )}
        </SectionCard>

        <SectionCard
          title="Operations"
          meta={`RPT-004 · ${meta}`}
          actions={
            <a href="/insights/operations" className="in-action-link" style={actionLink}>
              Open report
            </a>
          }
        >
          {hasStockValue || hasWaste || hasProduction ? (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
              <span
                style={{
                  fontSize: typography.fontSize["2xl"],
                  fontWeight: typography.fontWeight.regular,
                  lineHeight: typography.lineHeight.tight,
                  fontVariantNumeric: typography.fontVariantNumeric.tabular,
                  color: color.ink.primary,
                }}
              >
                {hasStockValue
                  ? `${formatMoney(operations.stockValue.total.valueOnHand)} ${currency}`
                  : "—"}
              </span>
              <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
                stock value on hand
                {hasStockValue ? ` as of ${formatAsOf(operations.stockValue.asOf)}` : ""} · waste{" "}
                {hasWaste && operations.waste.totals.value !== null
                  ? `${formatMoney(operations.waste.totals.value)} ${currency}`
                  : "n/a"}{" "}
                · {hasProduction ? operations.production.totals.batches : 0} production{" "}
                {operations.production.totals.batches === 1 ? "batch" : "batches"}
              </span>
              <span style={{ fontSize: typography.fontSize.xs, color: color.ink.tertiary }}>
                stock value is a point-in-time ledger balance, not period-bounded · waste value is
                moving average only
              </span>
            </div>
          ) : (
            <EmptyState title="No operational data in this period">
              No stock value, approved count, completed batch or waste event falls in {period.label}{" "}
              or before.
            </EmptyState>
          )}
        </SectionCard>
      </div>

      {/* The what-if simulation: a live model over the same cost/price/recipe
          data. It is not a report of facts, so it sits outside the previews
          grid and states plainly that it is a model. */}
      <SectionCard
        title="What-if simulation"
        meta="Model · assumptions, provenance and unmodelled terms shown"
        actions={
          <a href="/insights/simulation" className="in-action-link" style={actionLink}>
            Open simulation
          </a>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
          <p style={paragraph}>
            Model the effect of changing production volume, prices, wages, the menu and headcount
            over the existing cost, price and recipe data. Every result is labelled as a model and
            carries its assumptions, its provenance and the terms it cannot model.
          </p>
        </div>
      </SectionCard>

      {/* The analytical layer (W6): trends, benchmarks and the advisory
          forecast, each a real screen reading the same application services. */}
      <div className="in-previews">
        <SectionCard
          title="Trends"
          meta="W6 · period over period"
          actions={
            <a href="/insights/trends" className="in-action-link" style={actionLink}>
              Open trends
            </a>
          }
        >
          <p style={paragraph}>
            Each period&apos;s value against the previous one, with the absolute and relative change
            and a direction. The method and the flat band are stated on the screen.
          </p>
        </SectionCard>
        <SectionCard
          title="Benchmarks"
          meta="W6 · internal only"
          actions={
            <a href="/insights/benchmarks" className="in-action-link" style={actionLink}>
              Open benchmarks
            </a>
          }
        >
          <p style={paragraph}>
            Each location, product or channel against the organization aggregate and the peer median
            — internal data only, never an external market comparison.
          </p>
        </SectionCard>
        <SectionCard
          title="Forecast & suggestions"
          meta="W6 · model, not fact"
          actions={
            <a href="/insights/forecast" className="in-action-link" style={actionLink}>
              Open forecast
            </a>
          }
        >
          <p style={paragraph}>
            An advisory linear-trend projection with its ±1 residual-σ band and backtested accuracy,
            plus the rule-based suggestions with their evidence and next action. Never auto-applied.
          </p>
        </SectionCard>
      </div>

      {/* Live screens that are honestly bounded: forecast tracking is built
          (DEC-138) but states `no_snapshot`/`insufficient_history` rather than
          fabricating an accuracy, and the competitor register is human-reviewed
          only. */}
      <div className="in-planned">
        <SectionCard
          title="Forecast tracking"
          meta="W6 · projected vs actual"
          actions={
            <a href="/insights/forecast" className="in-action-link" style={actionLink}>
              Open forecast
            </a>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
            <StatusPill tone={tracking === null ? "neutral" : trackingStatusTone(tracking.status)}>
              {tracking === null ? "Per location" : trackingStatusLabel(tracking.status)}
            </StatusPill>
            <p style={paragraph}>
              {tracking === null
                ? "Tracking compares a recorded forecast snapshot with posted actuals, one location (or the whole organization) at a time — open the forecast screen for a single accessible location."
                : tracking.status === "ok"
                  ? `Projected against posted actuals at ${grainLabel(tracking.grain).toLowerCase()}: out-of-sample accuracy ${formatAccuracy(tracking.accuracy?.mape ?? null)} (MAPE, lower is better) over ${tracking.completedPeriods} completed ${tracking.completedPeriods === 1 ? "period" : "periods"}. The projected figure is a model, never a recorded fact.`
                  : `${tracking.reason ?? "Accuracy is not reported."} Tracking reports an accuracy only after ${tracking.minimumCompletedPeriods} completed periods, and never from too few points.`}
            </p>
          </div>
        </SectionCard>
        <SectionCard
          title="Competitors"
          meta="Live · reviewed observations only"
          actions={
            <a href="/insights/competitors" className="in-action-link" style={actionLink}>
              Open competitors
            </a>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
            <StatusPill tone="success">Register live</StatusPill>
            <p style={paragraph}>
              The competitor register and the dated observation log are built (DEC-126), behind a
              human-review gate (DEC-020): only reviewed observations are intelligence, and only
              those are compared against our prices. Automated permitted-source collection and
              seasonal analysis stay deferred.
            </p>
          </div>
        </SectionCard>
      </div>

      <p style={paragraph}>
        Contribution is net sales minus the moving-average ingredient cost posted to the stock
        ledger. It excludes direct labour, channel fees and allocated overhead, which are not
        computable yet, so no full cost or gross margin is shown (DEC-063). The menu-engineering
        thresholds are computed medians (DEC-109); the stock value is a point-in-time ledger balance
        and the waste value is moving-average only (DEC-110). Figures appear once source data is
        imported and posted.
      </p>
    </div>
  );
}
