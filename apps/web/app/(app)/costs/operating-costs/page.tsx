import { EmptyState, SectionCard, Table, Td, Th, color, spacing, typography } from "@aquarela/ui";

import { getCostingReadContext, loadOperatingCosts } from "../data";
import { formatMoney, formatWindow, orDash } from "../format";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/**
 * Operating costs (COST-003): the dated overhead facts, newest effective window
 * first. A null location is a company-shared cost, not a missing one.
 */
export default async function OperatingCostsPage() {
  const context = await getCostingReadContext();
  const rows = await loadOperatingCosts(context);

  return (
    <SectionCard
      title="Operating costs"
      meta={`${rows.length} ${rows.length === 1 ? "cost" : "costs"}`}
    >
      {rows.length === 0 ? (
        <EmptyState title="No operating costs registered">
          Operating costs (rent, utilities, subscriptions) appear here once registered against a
          cost centre. None exist in this organization yet.
        </EmptyState>
      ) : (
        <Table caption="Operating-cost facts, newest effective window first." columnCount={8}>
          <thead>
            <tr>
              <Th>Cost centre</Th>
              <Th>Location</Th>
              <Th>Vendor</Th>
              <Th style={numCell}>Amount</Th>
              <Th>Recurrence</Th>
              <Th>Behaviour</Th>
              <Th>Tax basis</Th>
              <Th>Effective</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>{orDash(row.costCenterName)}</Td>
                <Td>
                  {row.locationName === null ? (
                    <span style={{ color: color.text.muted }}>Company shared</span>
                  ) : (
                    row.locationName
                  )}
                </Td>
                <Td>{orDash(row.vendor)}</Td>
                <Td style={numCell}>
                  {formatMoney(row.amount)}{" "}
                  <span style={{ color: color.text.muted, fontSize: typography.fontSize.xs }}>
                    {row.currency}
                  </span>
                </Td>
                <Td>{row.recurrence}</Td>
                <Td>{row.behavior}</Td>
                <Td>{row.taxBasis}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {formatWindow(row.effectiveFrom, row.effectiveTo)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p
        style={{
          margin: `${spacing[3]}px 0 0`,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
        }}
      >
        The cost-pool amount derived from these rows is an application convention pending an owner
        decision; no pooled total is shown here.
      </p>
    </SectionCard>
  );
}
