import { EmptyState, SectionCard, Table, Td, Th, color, spacing, typography } from "@aquarela/ui";

import { getCostingReadContext, loadPriceVersions } from "../data";
import { formatInstant, formatInstantWindow, formatMoney, orDash } from "../format";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
const monoCell = {
  fontFamily: typography.fontFamily.mono,
  fontSize: typography.fontSize.xs,
  color: color.text.muted,
  whiteSpace: "nowrap",
} as const;

/**
 * Effective price versions (PRICE-002/003; `DEC-064`): the approved price for
 * each exact `(product variant, location, channel)` scope and its half-open
 * effective window, newest `effective_from` first. A row is created only by
 * approving a price scenario, so the source scenario links back to the approval.
 */
export default async function PriceVersionsPage() {
  const context = await getCostingReadContext();
  const rows = await loadPriceVersions(context);
  const currency = context.currency;
  const money = (value: string): string =>
    `${formatMoney(value)}${currency === null ? "" : ` ${currency}`}`;

  return (
    <SectionCard
      title="Price versions"
      meta={`${rows.length} ${rows.length === 1 ? "version" : "versions"}`}
    >
      {rows.length === 0 ? (
        <EmptyState title="No effective price versions yet">
          A price version appears when a draft or submitted price scenario is approved. None have
          been approved in this organization yet.
        </EmptyState>
      ) : (
        <Table caption="Effective price versions, newest effective window first." columnCount={9}>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Location</Th>
              <Th>Channel</Th>
              <Th style={numCell}>Gross price</Th>
              <Th style={numCell}>Net price</Th>
              <Th>Effective</Th>
              <Th>Approved at</Th>
              <Th>Approved by</Th>
              <Th>Source scenario</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <span style={{ fontWeight: typography.fontWeight.semibold }}>
                    {row.productVariantName ?? row.productVariantId}
                  </span>
                  {row.productVariantCode === null ? null : (
                    <span style={{ ...monoCell, display: "block" }}>{row.productVariantCode}</span>
                  )}
                </Td>
                <Td>
                  {row.locationName === null ? (
                    <span style={{ color: color.text.muted }}>All locations</span>
                  ) : (
                    orDash(row.locationName)
                  )}
                </Td>
                <Td>
                  {row.channelName === null ? (
                    <span style={{ color: color.text.muted }}>All channels</span>
                  ) : (
                    row.channelName
                  )}
                </Td>
                <Td style={numCell}>{money(row.grossPrice)}</Td>
                <Td style={numCell}>{money(row.netPrice)}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {formatInstantWindow(row.effectiveFrom, row.effectiveTo)}
                </Td>
                <Td style={{ whiteSpace: "nowrap" }}>{formatInstant(row.approvedAt)}</Td>
                <Td style={monoCell}>{row.approvedBy}</Td>
                <Td>
                  <a href={`/costs/price-scenarios/${row.sourceScenarioId}`}>View scenario</a>
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
        An “All locations”/“All channels” scope is the single organization-wide scope for that
        dimension, not a missing value. The effective window is half-open: the end instant belongs
        to the next version.
      </p>
    </SectionCard>
  );
}
