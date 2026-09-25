import {
  EmptyState,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

import { getCostingReadContext, loadCostCards } from "../data";
import { formatInstant, orDash, stateTone } from "../format";

export const dynamic = "force-dynamic";

/**
 * Cost cards list (08_UI_UX.md §8.3): every calculated card for the served
 * organization, newest first. Each row links to the detail with its variable
 * components, labour views, overhead allocation, history and source drill-down.
 */
export default async function CostCardsPage() {
  const context = await getCostingReadContext();
  const rows = await loadCostCards(context);

  return (
    <SectionCard title="Cost cards" meta={`${rows.length} ${rows.length === 1 ? "card" : "cards"}`}>
      {rows.length === 0 ? (
        <EmptyState title="No cost cards yet">
          A cost card appears once a product variant&apos;s cost is calculated and frozen as a
          snapshot. Calculating one needs a recipe and sourced ingredient costs, so none exist in
          this organization yet.
        </EmptyState>
      ) : (
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <Table caption="Calculated cost cards, newest first." columnCount={6}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Location</Th>
                <Th>Channel</Th>
                <Th>State</Th>
                <Th>Cost selection</Th>
                <Th>Calculated</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <a
                      href={`/costs/cost-cards/${row.id}`}
                      style={{ fontWeight: typography.fontWeight.semibold }}
                    >
                      {row.productVariantName ?? row.productVariantId}
                    </a>
                    {row.productVariantCode === null ? null : (
                      <span
                        style={{
                          display: "block",
                          fontFamily: typography.fontFamily.mono,
                          fontSize: typography.fontSize.xs,
                          color: color.text.muted,
                        }}
                      >
                        {row.productVariantCode}
                      </span>
                    )}
                  </Td>
                  <Td>{orDash(row.locationName ?? row.locationCode)}</Td>
                  <Td>
                    {row.channelName === null ? (
                      <span style={{ color: color.text.muted }}>All channels</span>
                    ) : (
                      row.channelName
                    )}
                  </Td>
                  <Td>
                    <StatusPill tone={stateTone(row.state)}>{row.state}</StatusPill>
                  </Td>
                  <Td>{row.costSelectionPolicy}</Td>
                  <Td style={{ whiteSpace: "nowrap" }}>{formatInstant(row.calculatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p
        style={{
          margin: `${spacing[3]}px 0 0`,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
        }}
      >
        Figures shown on a card detail come from its frozen calculation snapshot; this list carries
        identity, state and timing only.
      </p>
    </SectionCard>
  );
}
