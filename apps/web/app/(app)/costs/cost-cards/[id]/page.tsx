import { MONEY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
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
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound } from "next/navigation";

import { getCostingReadContext, loadCostCardDetail } from "../../data";
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

/** The component kinds that make up each detail section (COST-005). */
const VARIABLE_KINDS = ["ingredient", "packaging", "channel_variable", "other_variable"] as const;

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function provenanceEntries(
  provenance: Record<string, unknown>,
): readonly (readonly [string, string])[] {
  return Object.entries(provenance)
    .filter(
      ([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    .map(([key, value]) => [key, String(value)] as const);
}

function ProvenanceList({ provenance }: { readonly provenance: Record<string, unknown> }) {
  const entries = provenanceEntries(provenance);
  if (entries.length === 0) {
    return <span style={{ color: color.text.muted }}>No provenance recorded</span>;
  }
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
      {entries.map(([key, value]) => (
        <span
          key={key}
          style={{
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.fontSize.xs,
            color: color.text.secondary,
          }}
        >
          {key}={value}
        </span>
      ))}
    </span>
  );
}

/** Subtracts two 4 dp money strings through the domain decimal helpers. */
function deltaMoney(value: string, baseline: string): string {
  const difference = parseDecimal(value, MONEY_SCALE) - parseDecimal(baseline, MONEY_SCALE);
  const formatted = formatDecimal(difference, MONEY_SCALE);
  return difference > 0n ? `+${formatted}` : formatted;
}

/**
 * Product cost card detail (08_UI_UX.md §8.3): variable components, the direct
 * labour views, the allocated overhead, the historical comparison across
 * same-scope calculations and the source drill-down behind each stored
 * intermediate. All figures come from the card's frozen snapshot.
 */
export default async function CostCardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = uuidOrNotFound(rawId);
  const context = await getCostingReadContext();
  const detail = await loadCostCardDetail(context, id);
  if (detail === undefined) {
    notFound();
  }

  const currency = context.currency;
  const money = (value: string | null): string =>
    value === null ? "—" : `${formatMoney(value)}${currency === null ? "" : ` ${currency}`}`;

  const { card, snapshot, totals, components, history } = detail;
  const variableComponents = components.filter((component) =>
    (VARIABLE_KINDS as readonly string[]).includes(component.componentKind),
  );
  const labourComponents = components.filter(
    (component) => component.componentKind === "direct_labor",
  );
  const overheadComponents = components.filter(
    (component) => component.componentKind === "allocated_overhead",
  );
  const currentFullCost = totals?.unitFullCost ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        <a
          href="/costs/cost-cards"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: geometry.touchTarget,
            fontSize: typography.fontSize.sm,
            color: color.text.secondary,
          }}
        >
          ← All cost cards
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
            {card.productVariantName ?? card.productVariantId}
          </h2>
          <StatusPill tone={stateTone(card.state)}>{card.state}</StatusPill>
          {card.productVariantCode === null ? null : <Badge>{card.productVariantCode}</Badge>}
        </div>
        <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.muted }}>
          {orDash(card.locationName ?? card.locationCode)} · {card.channelName ?? "All channels"} ·{" "}
          {card.costSelectionPolicy} · calculated {formatInstant(card.calculatedAt)}
          {card.approvedAt === null ? "" : ` · approved ${formatInstant(card.approvedAt)}`}
        </p>
      </div>

      {snapshot === null ? (
        <EmptyState title="This card has no calculation snapshot">
          The card exists but its frozen calculation was not recorded, so no component, labour or
          overhead figures can be shown. Recalculate the card to produce a snapshot.
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
              label="Unit full cost"
              value={money(totals?.unitFullCost ?? null)}
              meta="Variable cost + allocated overhead"
            />
            <KpiCard
              label="Contribution after labour"
              value={money(totals?.contributionAfterDirectLabor ?? null)}
              meta="Net sales − variable cost after direct labour"
            />
            <KpiCard
              label="Contribution margin"
              value={
                totals?.contributionMarginPctAfterLabor == null
                  ? "n/a"
                  : formatPercent(totals.contributionMarginPctAfterLabor)
              }
              meta="Contribution over net price (DEC-063)"
            />
            <KpiCard
              label="Direct labour"
              value={money(totals?.directLaborCost ?? null)}
              meta={`${labourComponents.length} labour ${labourComponents.length === 1 ? "component" : "components"}`}
            />
          </div>

          <SectionCard
            title="Variable components"
            meta={`${variableComponents.length} ${variableComponents.length === 1 ? "component" : "components"} · snapshot ${snapshot.ruleVersion}`}
          >
            {variableComponents.length === 0 ? (
              <EmptyState title="No variable components recorded">
                The snapshot carries no ingredient, packaging, channel or other variable components.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table caption="Stored variable cost components." columnCount={6}>
                  <thead>
                    <tr>
                      <Th>Kind</Th>
                      <Th>Item</Th>
                      <Th style={numCell}>Quantity</Th>
                      <Th style={numCell}>Unit cost</Th>
                      <Th style={numCell}>Amount</Th>
                      <Th>Boundary</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {variableComponents.map((component) => (
                      <tr key={component.id}>
                        <Td>{component.componentKind}</Td>
                        <Td>
                          {component.itemName ?? component.itemId ?? (
                            <span style={{ color: color.text.muted }}>—</span>
                          )}
                          {component.itemCode === null ? null : (
                            <span
                              style={{
                                display: "block",
                                fontFamily: typography.fontFamily.mono,
                                fontSize: typography.fontSize.xs,
                                color: color.text.muted,
                              }}
                            >
                              {component.itemCode}
                            </span>
                          )}
                        </Td>
                        <Td style={numCell}>
                          {component.quantity === null ? (
                            "—"
                          ) : (
                            <>
                              {formatQuantity(component.quantity)}
                              {component.unitCode === null ? null : ` ${component.unitCode}`}
                            </>
                          )}
                        </Td>
                        <Td style={numCell}>
                          {component.unitCost === null ? "—" : formatMoney(component.unitCost)}
                        </Td>
                        <Td style={numCell}>
                          {component.amount === null ? "—" : formatMoney(component.amount)}
                        </Td>
                        <Td>{orDash(component.roundingBoundary)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Direct labour" meta="The two mandatory labour views (COST-005)">
            {labourComponents.length === 0 ? (
              <EmptyState title="No direct labour recorded">
                This snapshot has no `direct_labor` component, so no labour cost or view is shown.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table caption="Direct labour components and their recorded views." columnCount={3}>
                  <thead>
                    <tr>
                      <Th>Amount</Th>
                      <Th>Boundary</Th>
                      <Th>Views</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {labourComponents.map((component) => (
                      <tr key={component.id}>
                        <Td style={numCell}>
                          {component.amount === null ? "—" : formatMoney(component.amount)}
                        </Td>
                        <Td>{orDash(component.roundingBoundary)}</Td>
                        <Td>
                          <ProvenanceList provenance={component.provenance} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Overhead allocation" meta="Allocated unit overhead (COST-007/011)">
            {overheadComponents.length === 0 ? (
              <EmptyState title="No allocated overhead recorded">
                This snapshot has no `allocated_overhead` component; unit full cost therefore equals
                variable cost.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table caption="Allocated overhead components." columnCount={3}>
                  <thead>
                    <tr>
                      <Th>Amount</Th>
                      <Th>Boundary</Th>
                      <Th>Source</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {overheadComponents.map((component) => (
                      <tr key={component.id}>
                        <Td style={numCell}>
                          {component.amount === null ? "—" : formatMoney(component.amount)}
                        </Td>
                        <Td>{orDash(component.roundingBoundary)}</Td>
                        <Td>
                          <ProvenanceList provenance={component.provenance} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Historical comparison"
            meta={`${history.length} earlier ${history.length === 1 ? "calculation" : "calculations"} in this scope`}
          >
            {history.length === 0 ? (
              <EmptyState title="No earlier calculations for this scope">
                This is the only cost card for this product, location and channel, so there is
                nothing to compare against yet.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table
                  caption="Prior calculations for the same product, location and channel."
                  columnCount={5}
                >
                  <thead>
                    <tr>
                      <Th>Calculated</Th>
                      <Th>State</Th>
                      <Th style={numCell}>Unit full cost</Th>
                      <Th style={numCell}>Δ vs current</Th>
                      <Th>Card</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <Td style={{ whiteSpace: "nowrap" }}>
                          {formatInstant(entry.calculatedAt)}
                        </Td>
                        <Td>
                          <StatusPill tone={stateTone(entry.state)}>{entry.state}</StatusPill>
                        </Td>
                        <Td style={numCell}>{money(entry.totals?.unitFullCost ?? null)}</Td>
                        <Td style={numCell}>
                          {entry.totals?.unitFullCost == null || currentFullCost === null
                            ? "—"
                            : money(deltaMoney(entry.totals.unitFullCost, currentFullCost))}
                        </Td>
                        <Td>
                          <a
                            href={`/costs/cost-cards/${entry.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              minHeight: geometry.controlHeight.sm,
                            }}
                          >
                            View
                          </a>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Source drill-down"
            meta="Every stored intermediate behind this snapshot"
          >
            {components.length === 0 ? (
              <EmptyState title="No stored intermediates">
                The snapshot records totals only; no component rows were stored, so there is nothing
                to drill into.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table caption="All stored components with their provenance." columnCount={5}>
                  <thead>
                    <tr>
                      <Th>Kind</Th>
                      <Th style={numCell}>Amount</Th>
                      <Th>Boundary</Th>
                      <Th>Item / unit</Th>
                      <Th>Provenance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((component) => (
                      <tr key={component.id}>
                        <Td>{component.componentKind}</Td>
                        <Td style={numCell}>
                          {component.amount === null ? "—" : formatMoney(component.amount)}
                        </Td>
                        <Td>{orDash(component.roundingBoundary)}</Td>
                        <Td>
                          {component.itemName ?? component.itemId ?? "—"}
                          {component.unitCode === null ? null : ` · ${component.unitCode}`}
                        </Td>
                        <Td>
                          <ProvenanceList provenance={component.provenance} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
