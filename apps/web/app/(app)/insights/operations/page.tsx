import {
  buildOperationsReport,
  createPostgresReportingStore,
  type OperationsReport,
  type OperationsReportSection,
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
  formatAsOf,
  isGrain,
  metaLine,
  periodForGrain,
} from "../reports/report-labels";

import {
  formatFractionPct,
  formatMoney,
  formatQuantity,
  formatRatio,
  operationsRecordsHref,
  wasteStageLabel,
} from "./operations-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations — Aquarela Business Control" };

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

const actionLink = {
  color: color.brand.navy,
  fontWeight: typography.fontWeight.semibold,
  fontSize: typography.fontSize.sm,
} as const;

/** The "View records" drill-down link for a section (`RPT-002`). */
function recordsLink(section: OperationsReportSection, report: OperationsReport) {
  return (
    <a href={operationsRecordsHref(section, report)} style={actionLink}>
      View records
    </a>
  );
}

/**
 * Insights → Operations (`RPT-004`, rows 13e/13f, `DEC-110`): stock value and
 * variance, production yield and waste by stage, built from the existing
 * `DataTable`/`KpiCard`/`SectionCard` primitives. Server component: it calls the
 * application service directly, so the screen and the API cannot drift.
 *
 * Every figure carries its period, scope and freshness (`FND-006`), and the
 * actual definitions/caveats are visible: stock value is an as-of ledger balance
 * (not period-bounded); the variance value is the booked count adjustment, not
 * `variance_qty × cost`; yield is shown both as the stored fraction and the
 * actual/planned ratio; waste reasons use the `DEC-018` stage axis and the value
 * is moving-average only. Each section links to its records (`RPT-002`).
 */
export default async function InsightsOperationsPage({
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
          title="Operations"
          scope="Insights"
          description="Stock, production and waste reporting."
        />
        <EmptyState title="Not available for your role">
          The operational reports are not readable by your role.
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

  const report = await buildOperationsReport(store, {
    organizationId,
    from: period.from,
    to: period.to,
    grain,
    ...(locationIds === undefined ? {} : { locationIds }),
  });

  const meta = metaLine(period, report.scope, report.asOf);
  const stockValueMeta = metaLine(period, report.scope, report.stockValue.asOf);
  const hasStockValue = report.stockValue.rows.length > 0;
  const hasVariance = report.stockVariance.rows.length > 0;
  const hasProduction = report.production.rows.length > 0;
  const hasWaste = report.waste.rows.length > 0;
  const currency = report.currency;

  const stockValueColumns = [
    { key: "location", header: "Location" },
    { key: "valueOnHand", header: "Value on hand", align: "right" as const },
  ];
  const stockValueRows = report.stockValue.rows.map((row) => ({
    location: row.locationName ?? row.locationId,
    valueOnHand: `${formatMoney(row.valueOnHand)} ${currency}`,
  }));

  const varianceColumns = [
    { key: "location", header: "Location" },
    { key: "counts", header: "Counts", align: "right" as const },
    { key: "varianceQty", header: "Variance qty", align: "right" as const },
    { key: "adjustmentValue", header: "Adjustment value", align: "right" as const },
  ];
  const varianceRows = report.stockVariance.rows.map((row) => ({
    location: row.locationName ?? row.locationId,
    counts: String(row.counts),
    varianceQty: formatQuantity(row.varianceQty),
    adjustmentValue: `${formatMoney(row.adjustmentValue)} ${currency}`,
  }));

  const productionColumns = [
    { key: "location", header: "Location" },
    { key: "recipe", header: "Recipe" },
    { key: "batches", header: "Batches", align: "right" as const },
    { key: "planned", header: "Planned output", align: "right" as const },
    { key: "actual", header: "Actual output", align: "right" as const },
    { key: "variance", header: "Yield variance", align: "right" as const },
    { key: "ratio", header: "Yield ratio", align: "right" as const },
    { key: "input", header: "Input value", align: "right" as const },
    { key: "output", header: "Output value", align: "right" as const },
  ];
  const productionRows = report.production.rows.map((row) => ({
    location: row.locationName ?? row.locationId,
    recipe: row.recipeName ?? row.recipeVersionId,
    batches: String(row.batches),
    planned: formatQuantity(row.plannedOutput),
    actual: formatQuantity(row.actualOutput),
    variance: formatFractionPct(row.yieldVariancePct),
    ratio: formatRatio(row.yieldRatio),
    input: `${formatMoney(row.inputValue)} ${currency}`,
    output: `${formatMoney(row.outputValue)} ${currency}`,
  }));

  const wasteColumns = [
    { key: "stage", header: "Stage" },
    { key: "events", header: "Events", align: "right" as const },
    { key: "quantity", header: "Quantity (unit-blind)", align: "right" as const },
    { key: "value", header: "Value (moving average)", align: "right" as const },
  ];
  const wasteRows = report.waste.rows.map((row) => ({
    stage: wasteStageLabel(row.stage),
    events: String(row.events),
    quantity: formatQuantity(row.quantity),
    value: row.value === null ? "n/a" : `${formatMoney(row.value)} ${currency}`,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Operations"
        scope="Insights"
        description="Stock value and variance, production yield and waste by stage. Every section drills to its underlying records."
      />

      <Tabs
        items={GRAIN_OPTIONS.map((option) => ({
          label: GRAIN_LABELS[option],
          href: `/insights/operations?grain=${option}`,
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
          label="Stock value (as of)"
          value={
            hasStockValue ? `${formatMoney(report.stockValue.total.valueOnHand)} ${currency}` : "—"
          }
          meta={`as of ${formatAsOf(report.stockValue.asOf)} · point-in-time, not period-bounded`}
        />
        <KpiCard
          label="Stock variance adjustment"
          value={
            hasVariance
              ? `${formatMoney(report.stockVariance.totals.adjustmentValue)} ${currency}`
              : "—"
          }
          meta={`${report.stockVariance.totals.counts} approved ${report.stockVariance.totals.counts === 1 ? "count" : "counts"} · ${meta}`}
        />
        <KpiCard
          label="Production batches"
          value={hasProduction ? String(report.production.totals.batches) : "—"}
          meta={`yield ${formatFractionPct(report.production.totals.yieldVariancePct)} · ratio ${formatRatio(report.production.totals.yieldRatio)}`}
        />
        <KpiCard
          label="Waste value"
          value={
            hasWaste && report.waste.totals.value !== null
              ? `${formatMoney(report.waste.totals.value)} ${currency}`
              : "—"
          }
          meta={`${report.waste.totals.events} ${report.waste.totals.events === 1 ? "event" : "events"} · moving average only`}
        />
      </section>

      <SectionCard
        title="Stock value"
        meta={`Point-in-time ledger value by location, not period-bounded · ${stockValueMeta}`}
        actions={recordsLink("stock_value", report)}
      >
        {hasStockValue ? (
          <DataTable
            caption="Stock value on hand by location, as of the report instant"
            columns={stockValueColumns}
            rows={stockValueRows}
          />
        ) : (
          <EmptyState title="No stock value recorded">
            No stock movement falls at or before {formatAsOf(report.stockValue.asOf)}. Post a
            receipt or count adjustment, then this section fills in.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Stock variance"
        meta={`Approved counts · quantity and booked adjustment value by location · ${meta}`}
        actions={recordsLink("stock_variance", report)}
      >
        {hasVariance ? (
          <DataTable
            caption="Approved stock-count variance and booked adjustment value by location"
            columns={varianceColumns}
            rows={varianceRows}
          />
        ) : (
          <EmptyState title="No approved counts in this period">
            No approved stock count has a cutoff in {period.label}. Approve a count and this section
            fills in.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Production yield"
        meta={`Completed batches by location and recipe version · ${meta}`}
        actions={recordsLink("production", report)}
      >
        {hasProduction ? (
          <DataTable
            caption="Completed production batches: planned/actual output, yield and input/output value"
            columns={productionColumns}
            rows={productionRows}
          />
        ) : (
          <EmptyState title="No completed batches in this period">
            No production batch finished in {period.label}. Complete a batch and this section fills
            in.
          </EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Waste by stage"
        meta={`Events grouped by the DEC-018 stage axis · ${meta}`}
        actions={recordsLink("waste", report)}
      >
        {hasWaste ? (
          <DataTable
            caption="Waste events and value by stage"
            columns={wasteColumns}
            rows={wasteRows}
          />
        ) : (
          <EmptyState title="No waste recorded in this period">
            No waste event occurred in {period.label}. Record a waste event and this section fills
            in.
          </EmptyState>
        )}
      </SectionCard>

      <p style={paragraph}>
        Stock value is a point-in-time ledger balance (Σ value_delta at or before the as-of
        instant), not bounded by the report period. The variance value is the count adjustment
        actually booked to the stock ledger, not variance_qty × unit cost. Production yield is
        computed from the completed batches&apos; planned/actual output totals: variance is (actual
        − planned) / planned and the ratio is actual / planned, both shown as &ldquo;n/a&rdquo; when
        planned output is non-positive. Waste reasons use the DEC-018 stage axis; the free-text
        reason_code is not the axis. Waste value is moving-average only (DEC-068), item-only events
        are included, and the quantity sum is unit-blind.
      </p>
      <p style={paragraph}>{report.notes.join(" · ")}</p>
    </div>
  );
}
