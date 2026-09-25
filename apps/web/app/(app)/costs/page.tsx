import { KpiCard, SectionCard, spacing, typography } from "@aquarela/ui";

import {
  getCostingReadContext,
  loadAllocationRules,
  loadCostCards,
  loadCostPools,
  loadLaborRates,
  loadOperatingCosts,
  loadPriceScenarios,
} from "./data";

export const dynamic = "force-dynamic";

const sectionLinks = [
  { href: "/costs/cost-cards", label: "Cost cards" },
  { href: "/costs/price-scenarios", label: "Price scenarios" },
  { href: "/costs/operating-costs", label: "Operating costs" },
  { href: "/costs/labor-rates", label: "Labour rates" },
  { href: "/costs/cost-pools", label: "Cost pools" },
  { href: "/costs/allocation-rules", label: "Allocation rules" },
  { href: "/costs/channel-fee-rules", label: "Channel fees" },
];

/**
 * Costs overview: counts of the records behind each section, read from the same
 * application services as the section screens. It names the sections rather than
 * inventing a headline figure (§8.4).
 */
export default async function CostsPage() {
  const context = await getCostingReadContext();
  const [cards, scenarios, costs, rates, pools, rules] = await Promise.all([
    loadCostCards(context),
    loadPriceScenarios(context),
    loadOperatingCosts(context),
    loadLaborRates(context),
    loadCostPools(context),
    loadAllocationRules(context),
  ]);

  const counts = [
    { label: "Cost cards", value: cards.length, meta: "Calculated product costs" },
    { label: "Price scenarios", value: scenarios.length, meta: "Priced scenarios and approvals" },
    { label: "Operating costs", value: costs.length, meta: "Dated overhead facts" },
    { label: "Labour rates", value: rates.length, meta: "Loaded rates by role and cost centre" },
    { label: "Cost pools", value: pools.length, meta: "Shared-cost pools by version" },
    { label: "Allocation rules", value: rules.length, meta: "How pools are split" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        {counts.map((count) => (
          <KpiCard
            key={count.label}
            label={count.label}
            value={String(count.value)}
            meta={count.meta}
          />
        ))}
      </div>

      <SectionCard title="Sections" meta="08_UI_UX.md §8.3">
        <ul
          style={{
            margin: 0,
            paddingLeft: spacing[5],
            display: "flex",
            flexDirection: "column",
            gap: spacing[2],
            fontSize: typography.fontSize.md,
          }}
        >
          {sectionLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
