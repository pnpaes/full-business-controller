import {
  Badge,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  Sparkline,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Management home — Aquarela Business Control" };

/**
 * Owner/GM home (08_UI_UX.md §8.2, §8.4). Server component: no data is
 * fabricated. No business slices import yet, so every KPI shows an em dash
 * with its §8.4 meta line and each panel carries an honest empty state.
 * The single Sparkline uses explicitly sample points, labelled as such.
 */
const SAMPLE_NET_SALES = [42, 45, 41, 48, 52, 50, 57] as const;

const kpis = [
  {
    label: "Net sales",
    meta: "No period imported · all locations · vs prior period · awaiting sales import",
  },
  {
    label: "Gross margin %",
    meta: "No period imported · all locations · vs target · awaiting sales and cost data",
  },
  {
    label: "Stock value",
    meta: "As at latest count · all locations · vs prior count · awaiting opening balances",
  },
  {
    label: "Open exceptions",
    meta: "Rolling 7 days · all locations · vs no baseline · not yet evaluated",
  },
] as const;

export default function ManagementHomePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <PageHeader
        title="Management home"
        scope="Owner / GM · consolidated view"
        description="Sales, margin, stock and exception position across locations. Figures appear once source data is imported and reconciled."
      />

      <section
        aria-label="Key figures"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} label={kpi.label} value="—" meta={kpi.meta} />
        ))}
      </section>

      <SectionCard
        title="Exceptions and approvals"
        meta="Decision queue · all locations · latest import cycle · no runs yet"
      >
        <EmptyState title="No exceptions yet">
          No exceptions yet — sales, counts and receipts populate this once imported. When data
          arrives, each warning will show its threshold, evidence, owner and next action.
        </EmptyState>
      </SectionCard>

      <SectionCard
        title="Location comparison"
        meta="Normalized efficiency · per location · none available"
      >
        <EmptyState title="Not enough locations to compare">
          Location comparison needs at least two locations with imported data so totals and
          normalized efficiency measures can be shown side by side. Only one location is configured
          so far.
        </EmptyState>
      </SectionCard>

      <SectionCard
        title="Trend"
        meta="Is net sales trending up week over week? · sample"
        actions={<Badge>Sample</Badge>}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: spacing[3],
          }}
        >
          <Sparkline
            points={SAMPLE_NET_SALES}
            width={320}
            height={72}
            tone="berry"
            ariaLabel="Is net sales trending up week over week? Sample weekly net sales points, increasing overall."
          />
          <p
            style={{
              margin: 0,
              maxWidth: "60ch",
              fontSize: typography.fontSize.sm,
              lineHeight: typography.lineHeight.normal,
              color: color.text.muted,
            }}
          >
            Sample weekly net sales points, shown only to exercise the trend view. Real points
            replace them once sales are imported and reconciled.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
