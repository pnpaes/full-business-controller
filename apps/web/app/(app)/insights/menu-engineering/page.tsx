import {
  SALES_REPORT_CURRENCY,
  buildMenuEngineeringReport,
  createPostgresReportingStore,
  type MenuEngineeringReport,
  type MenuEngineeringRow,
} from "@aquarela/application";
import {
  Badge,
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
  formatAsOf,
  formatMoney,
  formatQuantity,
  isGrain,
  periodForGrain,
} from "../reports/report-labels";

import {
  classificationLabel,
  sourcePeriodLabel,
  thresholdValueLabel,
  wasteLabel,
} from "./menu-engineering-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu engineering — Aquarela Business Control" };

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
 * The drill-down href for one product row (`RPT-002`): the row-13c records
 * route with the report's window and the product's variant id, carrying the
 * caller's location scope as a list so a multi-location caller's drill-down
 * matches the matrix they read.
 */
function recordsHref(report: MenuEngineeringReport, row: MenuEngineeringRow): string {
  const params = new URLSearchParams({
    from: report.period.from,
    to: report.period.to,
    grain: report.grain,
    productVariantId: row.productVariantId,
  });
  if (report.scope.locationIds !== null && report.scope.locationIds.length > 0) {
    params.set("locationIds", report.scope.locationIds.join(","));
  }
  if (report.scope.channelId !== null) {
    params.set("channelId", report.scope.channelId);
  }
  return `/api/v1/reports/sales/records?${params.toString()}`;
}

/**
 * Insights → Menu engineering (`RPT-005`, `DEC-109`, `04_CALCULATIONS.md` §4.11):
 * a contribution/popularity matrix per product, composed from the existing
 * `DataTable`/`Badge`/`KpiCard` primitives (there is no charting/matrix
 * primitive, so none is added). Server component: it calls the application
 * service directly, so the screen and the API cannot drift.
 *
 * A product is `High` on popularity when its period units meet the median of
 * the per-product units, and `High` on contribution when its contribution
 * before labour/fees meets the median within its own category. Both thresholds
 * are computed and echoed with their value and source period (`FND-006`,
 * `DEC-109` item 1) — never only a label, and never a Star/Puzzle name
 * (`DEC-109` item 2). Contribution is **before** direct labour, channel fees and
 * allocated overhead; waste is shown only where a waste event names the variant.
 */
export default async function MenuEngineeringPage({
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
          title="Menu engineering"
          scope="Insights"
          description="Popularity and contribution by product."
        />
        <EmptyState title="Not available for your role">
          The menu-engineering matrix is not readable by your role.
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

  const report = await buildMenuEngineeringReport(store, {
    organizationId,
    from: period.from,
    to: period.to,
    grain,
    ...(locationIds === undefined ? {} : { locationIds }),
  });

  const hasData = report.rows.length > 0;
  const scopeText =
    report.scope.locationIds === null
      ? "All locations"
      : `${report.scope.locationIds.length} ${report.scope.locationIds.length === 1 ? "location" : "locations"}`;
  const meta = `${period.label} · ${scopeText} · as of ${formatAsOf(report.asOf)}`;
  const popularity = report.threshold.popularity;
  const contribution = report.threshold.contribution;

  const columns = [
    { key: "product", header: "Product" },
    { key: "category", header: "Category" },
    { key: "units", header: "Units", align: "right" as const },
    { key: "contribution", header: "Contribution (before labour/fees)", align: "right" as const },
    { key: "popularity", header: "Popularity", align: "center" as const },
    { key: "contributionClass", header: "Contribution class", align: "center" as const },
    { key: "waste", header: "Waste", align: "right" as const },
  ];
  const rows = report.rows.map((row) => ({
    product: row.label,
    category: row.category ?? "—",
    units: formatQuantity(row.units),
    contribution: `${formatMoney(row.contributionBeforeLabour)} ${SALES_REPORT_CURRENCY}`,
    popularity: <Badge>{classificationLabel(row.popularityHigh)}</Badge>,
    contributionClass: (
      <span style={{ display: "inline-flex", gap: spacing[2], alignItems: "baseline" }}>
        <Badge>{classificationLabel(row.contributionHigh)}</Badge>
        <span style={{ color: color.text.muted, fontSize: typography.fontSize.sm }}>
          ≥{" "}
          {row.contributionThreshold === null
            ? "n/a"
            : `${formatMoney(row.contributionThreshold)} ${SALES_REPORT_CURRENCY}`}
        </span>
      </span>
    ),
    waste: wasteLabel(row.waste),
    href: recordsHref(report, row),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Menu engineering"
        scope="Insights"
        description="Popularity against the median per-product units, and contribution before labour/fees against the median within each category. Every product drills to its sales lines."
      />

      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: `/insights/menu-engineering?grain=${option}`,
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
          label="Products analysed"
          // The row list is capped at MENU_ENGINEERING_MAX_ROWS, so a truncated
          // report shows the capped count with a "+" rather than understating it.
          value={
            hasData
              ? report.truncated
                ? `${report.rows.length}+`
                : String(report.rows.length)
              : "—"
          }
          meta={meta}
        />
        <KpiCard
          label="Popularity threshold"
          value={hasData ? thresholdValueLabel(popularity) : "—"}
          meta={`median of per-product units · ${sourcePeriodLabel(popularity.sourcePeriod)}`}
        />
        <KpiCard
          label="Contribution threshold"
          value={thresholdValueLabel(contribution)}
          meta={`${contribution.statistic.replace("_", " ")} · ${sourcePeriodLabel(contribution.sourcePeriod)}`}
        />
      </section>

      <SectionCard
        title="Contribution / popularity matrix"
        meta={`${report.rows.length} ${report.rows.length === 1 ? "product" : "products"} · ${meta}`}
      >
        {hasData ? (
          <DataTable
            caption="Products classified by popularity and contribution before labour/fees"
            columns={columns}
            rows={rows}
            rowHref={(row) => String(row["href"])}
          />
        ) : (
          <EmptyState title="No classifiable products">
            No posted sales line in {period.label} resolved to a product variant, so there is
            nothing to classify against the thresholds. Unresolved lines are reported as the
            unmapped bucket below, never classified. Import a sales file and post theoretical
            consumption, then this matrix fills in.
          </EmptyState>
        )}
      </SectionCard>

      {report.unmapped !== null ? (
        <p style={paragraph}>
          Unmapped: {formatQuantity(report.unmapped.units)} units and{" "}
          {formatMoney(report.unmapped.netSales)} {SALES_REPORT_CURRENCY} of net sales on lines with
          no resolved product variant. They are reported here, not classified, because a threshold
          cannot be computed for them.
          {report.truncated
            ? " The row list was capped; the thresholds are still computed over every product in scope."
            : ""}
        </p>
      ) : null}

      <p style={paragraph}>
        Popularity is high when a product&apos;s units are at or above the median of the per-product
        units over {sourcePeriodLabel(popularity.sourcePeriod)}. Contribution is high when its net
        sales minus the moving-average ingredient cost are at or above the median within its own
        category over {sourcePeriodLabel(contribution.sourcePeriod)}; the actual threshold is shown
        on each row. Both thresholds are computed medians, never configured targets, and no
        Star/Puzzle naming is applied (DEC-109).
      </p>
      <p style={paragraph}>
        Contribution stops before direct labour, channel fees and allocated overhead, which have no
        per-product attribution rule yet, so it is never a full cost or gross margin. Waste is shown
        only where a waste event names the product variant; item-level waste has no attribution rule
        and is not attributed. Forecast reliability and strategic role are not shown.
      </p>
      <p style={paragraph}>{report.notes.join(" · ")}</p>
    </div>
  );
}
