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

import { getCostingReadContext, loadPriceScenarios } from "../data";
import { formatInstant, formatMoney, formatPercent, orDash, stateTone } from "../format";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/**
 * Price scenarios list (08_UI_UX.md §8.3): every scenario for the served
 * organization, newest first, with its proposed price and contribution. Each row
 * links to the detail for tax/fees, margins, volume effect and sensitivity.
 */
export default async function PriceScenariosPage() {
  const context = await getCostingReadContext();
  const rows = await loadPriceScenarios(context);
  const currency = context.currency;
  const money = (value: string | null): string =>
    value === null ? "—" : `${formatMoney(value)}${currency === null ? "" : ` ${currency}`}`;

  return (
    <SectionCard
      title="Price scenarios"
      meta={`${rows.length} ${rows.length === 1 ? "scenario" : "scenarios"}`}
    >
      {rows.length === 0 ? (
        <EmptyState title="No price scenarios yet">
          A scenario appears once a price or a target contribution is modelled for a product. None
          have been calculated in this organization yet.
        </EmptyState>
      ) : (
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <Table caption="Price scenarios, newest first." columnCount={8}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Location</Th>
                <Th>Channel</Th>
                <Th>State</Th>
                <Th style={numCell}>Gross price</Th>
                <Th style={numCell}>Net price</Th>
                <Th style={numCell}>Contribution margin</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <a
                      href={`/costs/price-scenarios/${row.id}`}
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
                  <Td>{orDash(row.locationName)}</Td>
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
                  <Td style={numCell}>{money(row.presentedGrossPrice ?? row.grossPrice)}</Td>
                  <Td style={numCell}>{money(row.presentedNetPrice ?? row.netPrice)}</Td>
                  <Td style={numCell}>
                    {row.contributionMarginPct === null
                      ? "n/a"
                      : formatPercent(row.contributionMarginPct)}
                  </Td>
                  <Td style={{ whiteSpace: "nowrap" }}>{formatInstant(row.createdAt)}</Td>
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
        Contribution margin is contribution over net price (DEC-063); a scenario with no price yet
        shows “n/a”.
      </p>
    </SectionCard>
  );
}
