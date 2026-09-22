import {
  SALES_REPORT_CURRENCY,
  buildSalesReport,
  createPostgresReportingStore,
  type SalesReport,
  type SalesReportGroup,
} from "@aquarela/application";
import {
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
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
  GRAIN_LABELS,
  GRAIN_OPTIONS,
  GROUP_BY_LABELS,
  GROUP_BY_OPTIONS,
  formatMoney,
  formatPct,
  formatQuantity,
  isGrain,
  isGroupBy,
  metaLine,
  periodForGrain,
} from "../reports/report-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Aquarela Business Control" };

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
 * The drill-down href for one group (`RPT-002`): the records route with the
 * report's window and the group's dimension filter. A `location` group drills
 * into its own location; every other group carries the caller's whole location
 * scope (as `locationIds`) so a multi-location caller's drill-down matches the
 * summary the page read — a `period` group has no dimension filter either, so it
 * links to the whole in-scope window.
 */
function recordsHref(report: SalesReport, group: SalesReportGroup): string {
  const params = new URLSearchParams({
    from: report.period.from,
    to: report.period.to,
    grain: report.grain,
  });
  if (group.locationId !== null) {
    params.set("locationId", group.locationId);
  } else if (report.scope.locationIds !== null && report.scope.locationIds.length > 0) {
    params.set("locationIds", report.scope.locationIds.join(","));
  }
  if (group.channelId !== null) params.set("channelId", group.channelId);
  if (group.category !== null) params.set("category", group.category);
  if (group.productVariantId !== null) params.set("productVariantId", group.productVariantId);
  return `/api/v1/reports/sales/records?${params.toString()}`;
}

/**
 * Insights → Reports (`RPT-001`, `RPT-002`, `ADR-0007`): the same sales & margin
 * report the Management home reads, rendered by `groupBy` with a drill-down link
 * from every group to the records route. Server component: it calls the
 * application service directly (the reconciliation-page precedent), so the
 * screen and the API cannot drift.
 *
 * Every figure carries its period, scope and freshness (`FND-006`); contribution
 * is **before** direct labour, channel fees and allocated overhead (`DEC-063`).
 * Menu engineering (`RPT-005`), stock/production/waste reporting (`RPT-004`),
 * normalized location measures and full cost are explicitly out of scope.
 */
export default async function InsightsReportsPage({
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
          title="Reports"
          scope="Insights"
          description="Sales and contribution reporting."
        />
        <EmptyState title="Not available for your role">
          The sales and contribution reports are not readable by your role.
        </EmptyState>
      </div>
    );
  }

  const params = toSearchParams(await searchParams);
  const grainParam = params.get("grain")?.trim();
  const grain = grainParam !== undefined && isGrain(grainParam) ? grainParam : "month";
  const groupByParam = params.get("groupBy")?.trim();
  const groupBy = groupByParam !== undefined && isGroupBy(groupByParam) ? groupByParam : "category";
  const period = periodForGrain(grain, new Date());

  const organizationId = resolveOrganization();
  const store = createPostgresReportingStore(getDb().db);
  const locationIds = access.locationIds.length > 0 ? access.locationIds : undefined;

  const report = await buildSalesReport(store, {
    organizationId,
    actorId: session.userId,
    from: period.from,
    to: period.to,
    grain,
    groupBy,
    ...(locationIds === undefined ? {} : { locationIds }),
  });

  const hasData = report.totals.transactions > 0;
  const meta = metaLine(period, report.scope, report.asOf);
  const dimensionHeader = GROUP_BY_LABELS[groupBy];
  const columns = [
    { key: "group", header: dimensionHeader },
    { key: "transactions", header: "Transactions", align: "right" as const },
    { key: "units", header: "Units", align: "right" as const },
    { key: "netSales", header: "Net sales", align: "right" as const },
    { key: "ingredientCost", header: "Ingredient cost", align: "right" as const },
    { key: "contribution", header: "Contribution", align: "right" as const },
    { key: "margin", header: "Margin", align: "right" as const },
  ];
  const rows = report.groups.map((group) => ({
    group: group.label,
    transactions: String(group.transactions),
    units: formatQuantity(group.units),
    netSales: `${formatMoney(group.netSales)} ${SALES_REPORT_CURRENCY}`,
    ingredientCost: `${formatMoney(group.ingredientCost)} ${SALES_REPORT_CURRENCY}`,
    contribution: `${formatMoney(group.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`,
    margin: formatPct(group.contributionMarginPct),
    href: recordsHref(report, group),
  }));
  const reportHref = (nextGroupBy: string, nextGrain: string): string =>
    `/insights/reports?grain=${nextGrain}&groupBy=${nextGroupBy}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Reports"
        scope="Insights"
        description="Sales, ingredient cost and contribution before labour/fees, grouped by location, channel, category, product or period. Every group drills to its records."
      />

      <Tabs
        items={GROUP_BY_OPTIONS.map((option) => ({
          label: GROUP_BY_LABELS[option],
          href: reportHref(option, grain),
          active: option === groupBy,
        }))}
        ariaLabel="Report grouping"
      />
      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: reportHref(groupBy, option),
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
          label="Ingredient cost"
          value={
            hasData ? `${formatMoney(report.totals.ingredientCost)} ${SALES_REPORT_CURRENCY}` : "—"
          }
          meta={meta}
        />
        <KpiCard
          label="Contribution before labour"
          value={
            hasData
              ? `${formatMoney(report.totals.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`
              : "—"
          }
          meta={`${meta} · margin ${formatPct(report.totals.contributionMarginPct)}`}
        />
        <KpiCard
          label="Transactions"
          value={hasData ? String(report.totals.transactions) : "—"}
          meta={meta}
        />
      </section>

      <SectionCard
        title={`Sales by ${dimensionHeader.toLowerCase()}`}
        meta={`Which ${dimensionHeader.toLowerCase()}s sell most and contribute most? · ${report.groups.length} ${report.groups.length === 1 ? "group" : "groups"}`}
      >
        {hasData ? (
          <DataTable
            caption={`Sales, ingredient cost and contribution by ${dimensionHeader.toLowerCase()}`}
            columns={columns}
            rows={rows}
            rowHref={(row) => String(row["href"])}
          />
        ) : (
          <EmptyState title="No sales in this period">
            No posted sales lines fall in {period.label}. Import a sales file and post theoretical
            consumption, then this report fills in.
          </EmptyState>
        )}
      </SectionCard>

      <p style={paragraph}>
        Contribution is net sales minus the moving-average ingredient cost posted to the stock
        ledger. It excludes direct labour, channel fees and allocated overhead, which are not
        computable yet, so no full cost or gross margin is shown. Rows labelled “Unmapped” have no
        product variant or category on the sales line. Totals only: normalized efficiency measures
        are undefined and deferred (RPT-003).
      </p>
    </div>
  );
}
