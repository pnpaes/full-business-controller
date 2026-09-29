import {
  SALES_REPORT_CURRENCY,
  buildSalesReport,
  createPostgresReportingStore,
} from "@aquarela/application";
import {
  Badge,
  Collapsible,
  EmptyState,
  InfoTip,
  MetricBand,
  MetricHero,
  MetricSecondary,
  PageHeader,
  Tabs,
  breakpoint,
  color,
  formatMoney,
  formatNumber,
  groupDecimal,
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
import { LocationComparisonTable } from "./home-modules";
import {
  GRAIN_LABELS,
  GRAIN_OPTIONS,
  formatPct,
  formatQuantity,
  isGrain,
  metaLine,
  periodForGrain,
  scopeLabel,
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

/**
 * Page-scoped responsive rule — the only styling inline styles cannot express:
 * the comparison table drops its ingredient-cost column on phones.
 */
const pageCss = `
@media (max-width: ${breakpoint.tablet - 1}px) {
  .mh-col-cost { display: none; }
}
`;

/** Quiet inline link used in microcopy and the signal list. */
const inlineLink = {
  color: color.ink.primary,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
  textDecorationColor: color.border.strong,
  textUnderlineOffset: 3,
} as const;

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
 * The operational registers the exception queue reads from. Each is a deep
 * link, not a count: no read exists for cross-register counts on the home
 * server path yet, so the band links to the action that fills the queue
 * instead of inventing numbers.
 */
const operationalSignals = [
  {
    label: "Dead-lettered jobs",
    href: "/jobs?status=dead_lettered",
    note: "failed jobs awaiting retry or discard",
  },
  { label: "Open tasks", href: "/tasks?status=open", note: "operational follow-up work" },
  {
    label: "Shift approvals",
    href: "/workforce/shifts",
    note: "self-assignments awaiting a manager decision",
  },
  { label: "Sales imports", href: "/sales/import", note: "runs staged, validated and posted" },
  { label: "Period close", href: "/close", note: "location days and the company month" },
] as const;

/**
 * Owner/GM home (`08_UI_UX.md` §8.2, §8.4; `RPT-001`, `RPT-003`, `FND-006`).
 * Server component: reads the same application service the reporting API uses
 * (`buildSalesReport` over `createPostgresReportingStore`) rather than an HTTP
 * round-trip, so the screen and the API cannot drift.
 *
 * Composition (UX contract, `docs/ux/README.md`): one ranked hero metric —
 * net sales for the selected grain, with the day-over-day movement and the
 * contribution definition as an (i) `InfoTip` — followed by three quiet
 * secondary metrics on the same band. Detail is progressive: the location
 * comparison and the exception queue are collapsed `Collapsible` sections,
 * and the full report stays one link away at `/insights/reports`. No uniform
 * card wall, no internal references in the copy (the former `DEC-063` /
 * `RPT-003` footnote moved into the InfoTip and the comparison meta).
 *
 * Every figure carries its period, scope and freshness (`FND-006`) and is
 * formatted with the Wave 0 decimal formatters (grouped money/numbers, never
 * floats — the only float is the day-over-day percentage, a trend chip, not
 * a reported figure). The location comparison is **totals only** — normalized
 * efficiency measures are undefined and deferred (`RPT-003`). An empty period
 * shows honest empty states with the next action (`08:72`).
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
  const marginPct = report.totals.contributionMarginPct;

  // Day-over-day movement of net sales inside the period. Presentation-only
  // arithmetic for the trend chip (like the sparkline coordinate it replaces);
  // every reported figure below stays a decimal string.
  const dayNetSales = trend.groups.map((group) => Number(group.netSales));
  let salesDelta: string | undefined;
  let salesTrend: "up" | "down" | "flat" | undefined;
  if (hasData) {
    const latestDay = dayNetSales[dayNetSales.length - 1];
    const previousDay = dayNetSales[dayNetSales.length - 2];
    if (latestDay !== undefined && previousDay !== undefined && previousDay > 0) {
      const changePct = Math.round(((latestDay - previousDay) / previousDay) * 1000) / 10;
      salesDelta = `${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%`;
      salesTrend = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
    }
  }

  const comparisonRows = report.groups.map((group) => ({
    location: group.label,
    href: group.locationId === null ? null : locationRecordsHref(period, grain, group.locationId),
    netSales: formatMoney(group.netSales, { currency: SALES_REPORT_CURRENCY }),
    ingredientCost: formatMoney(group.ingredientCost, { currency: SALES_REPORT_CURRENCY }),
    contribution: formatMoney(group.contributionBeforeLabour, { currency: SALES_REPORT_CURRENCY }),
    margin: formatPct(group.contributionMarginPct),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />

      <PageHeader
        title="Management home"
        scope="Owner / GM · consolidated view"
        description="Net sales, contribution and the exception position across locations, for the selected period."
      />

      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: `/?grain=${option}`,
          active: option === grain,
        }))}
        ariaLabel="Reporting period grain"
      />

      {/* The one ranked hero metric for the screen, with three quiet
          secondaries ranked after it on the same band. */}
      <MetricBand
        hero={
          <MetricHero
            label="Net sales"
            value={hasData ? formatMoney(report.totals.netSales) : "—"}
            {...(hasData ? { unit: SALES_REPORT_CURRENCY } : {})}
            {...(salesDelta !== undefined ? { delta: salesDelta } : {})}
            {...(salesTrend !== undefined ? { trend: salesTrend } : {})}
            comparison={hasData ? "vs previous day" : "No posted sales in this period yet."}
            meta={hasData ? meta : `${period.label} · ${scopeLabel(report.scope)} · no data yet`}
            info={
              <InfoTip
                content="Net sales are the posted sales lines for the period. Contribution is net sales minus the moving-average ingredient cost posted to the stock ledger; it excludes direct labour, channel fees and allocated overhead, which are not computable yet, so no full cost or gross margin is shown."
                label="How net sales and contribution are calculated"
              />
            }
          />
        }
        metrics={[
          <MetricSecondary
            key="transactions"
            label="Transactions"
            value={
              hasData ? formatNumber(String(report.totals.transactions), { decimals: 0 }) : "—"
            }
          />,
          <MetricSecondary
            key="units"
            label="Units"
            value={hasData ? groupDecimal(formatQuantity(report.totals.units)) : "—"}
          />,
          <MetricSecondary
            key="contribution"
            label="Contribution before labour"
            value={
              hasData
                ? `${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`
                : "—"
            }
            {...(hasData ? { meta: `margin ${formatPct(marginPct)}` } : {})}
          />,
        ]}
      />

      <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
        Full sales and contribution reporting, grouped by location, channel, category or product:{" "}
        <a href="/insights/reports" style={inlineLink}>
          Insights · Reports
        </a>
        .
      </p>

      {/* Secondary sections: collapsed by default, content and deep links intact. */}
      <Collapsible
        summary="Location comparison"
        badge={
          <Badge>
            {hasData
              ? `${report.groups.length} ${report.groups.length === 1 ? "location" : "locations"}`
              : "no data"}
          </Badge>
        }
      >
        {hasData ? (
          <LocationComparisonTable
            caption="Sales totals by location for the selected period; each location drills into its records."
            rows={comparisonRows}
          />
        ) : (
          <EmptyState variant="plain" title="No sales in this period">
            No posted sales lines fall in {period.label}.{" "}
            <a href="/sales/import" style={inlineLink}>
              Import a sales file
            </a>{" "}
            and post theoretical consumption, then this comparison fills in.
          </EmptyState>
        )}
      </Collapsible>

      <Collapsible summary="Exceptions and approvals" badge={<Badge>decision queue</Badge>}>
        <EmptyState variant="plain" title="No exceptions yet">
          Sales, counts and receipts populate this queue once imported. When data arrives, each
          warning shows its threshold, evidence, owner and next action.
        </EmptyState>
        <p
          style={{
            margin: `${spacing[4]}px 0 ${spacing[2]}px`,
            fontSize: typography.fontSize.sm,
            color: color.ink.secondary,
          }}
        >
          The registers behind the queue:
        </p>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: spacing[2],
          }}
        >
          {operationalSignals.map((signal) => (
            <li
              key={signal.href}
              style={{ fontSize: typography.fontSize.md, color: color.ink.secondary }}
            >
              <a href={signal.href} style={inlineLink}>
                {signal.label}
              </a>{" "}
              — {signal.note}
            </li>
          ))}
        </ul>
      </Collapsible>
    </div>
  );
}
