import {
  Badge,
  EmptyState,
  KpiCard,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound } from "next/navigation";

import { getCostingReadContext, loadPriceScenarioDetail } from "../../data";
import {
  formatInstant,
  formatMoney,
  formatPercent,
  formatQuantity,
  orDash,
  stateTone,
} from "../../format";
import { uuidOrNotFound } from "../../../../../lib/route-params";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

interface DetailItem {
  readonly label: string;
  readonly value: string;
}

function DefinitionRows({ items }: { readonly items: readonly DetailItem[] }) {
  return (
    <Table caption="Scenario figures." columnCount={2}>
      <thead>
        <tr>
          <Th>Measure</Th>
          <Th style={numCell}>Value</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.label}>
            <Td>{item.label}</Td>
            <Td style={numCell}>{item.value}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Price scenario detail (08_UI_UX.md §8.3): current/proposed price, tax, fees,
 * margins, volume effect, sensitivity and approval. Every figure is the stored
 * scenario outcome — nothing is recomputed on the screen.
 */
export default async function PriceScenarioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = uuidOrNotFound(rawId);
  const context = await getCostingReadContext();
  const scenario = await loadPriceScenarioDetail(context, id);
  if (scenario === undefined) {
    notFound();
  }

  const currency = context.currency;
  const money = (value: string | null): string =>
    value === null ? "—" : `${formatMoney(value)}${currency === null ? "" : ` ${currency}`}`;
  const hasPrice = scenario.presentedGrossPrice !== null || scenario.grossPrice !== null;

  const priceItems: readonly DetailItem[] = [
    {
      label: "Proposed gross price",
      value: money(scenario.presentedGrossPrice ?? scenario.grossPrice),
    },
    { label: "Net price", value: money(scenario.presentedNetPrice ?? scenario.netPrice) },
    { label: "Included tax", value: money(scenario.includedTax) },
  ];
  const marginItems: readonly DetailItem[] = [
    { label: "Unit variable cost", value: money(scenario.unitVariableCost) },
    { label: "Channel variable cost", value: money(scenario.channelVariableCost) },
    { label: "Unit contribution", value: money(scenario.unitContribution) },
    {
      label: "Contribution margin",
      value:
        scenario.contributionMarginPct === null
          ? "n/a"
          : formatPercent(scenario.contributionMarginPct),
    },
  ];
  const sensitivityItems: readonly DetailItem[] = [
    {
      label: "Required gross price (target contribution)",
      value: money(scenario.requiredGrossPrice),
    },
    {
      label: "Break-even units",
      value: scenario.breakEvenUnits === null ? "—" : formatQuantity(scenario.breakEvenUnits),
    },
    {
      label: "Volume assumption",
      value: scenario.volumeAssumption === null ? "—" : formatQuantity(scenario.volumeAssumption),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        <a
          href="/costs/price-scenarios"
          style={{ fontSize: typography.fontSize.sm, color: color.text.secondary }}
        >
          ← All price scenarios
        </a>
        <div style={{ display: "flex", alignItems: "baseline", gap: spacing[3], flexWrap: "wrap" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: typography.fontFamily.display,
              fontSize: typography.fontSize["2xl"],
              color: color.brand.navy,
            }}
          >
            {scenario.productVariantName ?? scenario.productVariantId}
          </h2>
          <StatusPill tone={stateTone(scenario.state)}>{scenario.state}</StatusPill>
          {scenario.productVariantCode === null ? null : (
            <Badge>{scenario.productVariantCode}</Badge>
          )}
        </div>
        <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.muted }}>
          {orDash(scenario.locationName)} · {scenario.channelName ?? "All channels"} · created{" "}
          {formatInstant(scenario.createdAt)}
        </p>
      </div>

      {!hasPrice ? (
        <EmptyState title="This scenario has no price yet">
          The scenario was recorded without a gross price or a target contribution, so no margin,
          sensitivity or volume figures exist. Set a price or a target contribution to calculate
          one.
        </EmptyState>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: spacing[4],
            }}
          >
            <KpiCard
              label="Proposed price"
              value={money(scenario.presentedGrossPrice ?? scenario.grossPrice)}
              meta="Gross, as presented"
            />
            <KpiCard
              label="Net price"
              value={money(scenario.presentedNetPrice ?? scenario.netPrice)}
              meta="After tax, discounts and refunds"
            />
            <KpiCard
              label="Unit contribution"
              value={money(scenario.unitContribution)}
              meta="Net price − unit variable cost"
            />
            <KpiCard
              label="Contribution margin"
              value={
                scenario.contributionMarginPct === null
                  ? "n/a"
                  : formatPercent(scenario.contributionMarginPct)
              }
              meta="Contribution over net price (DEC-063)"
            />
          </div>

          <SectionCard title="Price and tax" meta="Gross, net and included tax">
            <DefinitionRows items={priceItems} />
          </SectionCard>

          <SectionCard title="Margins" meta="Unit variable cost, fees and contribution">
            <DefinitionRows items={marginItems} />
          </SectionCard>

          <SectionCard
            title="Sensitivity and volume"
            meta="Target price, break-even and assumed volume"
          >
            <DefinitionRows items={sensitivityItems} />
          </SectionCard>

          <SectionCard title="Approval" meta="Scenario state and assumptions">
            <Table caption="Approval and assumption fields." columnCount={2}>
              <thead>
                <tr>
                  <Th>Field</Th>
                  <Th style={numCell}>Value</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>State</Td>
                  <Td style={numCell}>
                    <StatusPill tone={stateTone(scenario.state)}>{scenario.state}</StatusPill>
                  </Td>
                </tr>
                <tr>
                  <Td>Target contribution</Td>
                  <Td style={numCell}>
                    {scenario.targetContributionPct === null
                      ? "—"
                      : formatPercent(scenario.targetContributionPct)}
                  </Td>
                </tr>
                <tr>
                  <Td>Fee breakdown</Td>
                  <Td style={numCell}>
                    {Object.keys(scenario.feeBreakdown).length === 0 ? (
                      <span style={{ color: color.text.muted }}>No channel fees</span>
                    ) : (
                      <span
                        style={{
                          fontFamily: typography.fontFamily.mono,
                          fontSize: typography.fontSize.xs,
                        }}
                      >
                        {JSON.stringify(scenario.feeBreakdown)}
                      </span>
                    )}
                  </Td>
                </tr>
              </tbody>
            </Table>
          </SectionCard>
        </>
      )}
    </div>
  );
}
