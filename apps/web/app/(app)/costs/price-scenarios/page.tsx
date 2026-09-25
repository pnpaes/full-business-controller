import {
  EmptyState,
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
import {
  createPostgresInventoryStore,
  createPostgresProductStore,
  listLocations,
  listProducts,
} from "@aquarela/application";
import { TAX_BASES } from "@aquarela/domain";

import { getDb } from "../../../../lib/db";

import { getCostingReadContext, loadChannels, loadPriceScenarios } from "../data";
import { formatInstant, formatMoney, formatPercent, orDash, stateTone } from "../format";

import { RegisterScenarioForm } from "./register-scenario-form";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/**
 * Price scenarios list (08_UI_UX.md §8.3): every scenario for the served
 * organization, newest first, with its proposed price and contribution. Each row
 * links to the detail for tax/fees, margins, volume effect and sensitivity. The
 * calculate form posts to `POST /api/v1/costing/price-scenarios`; approving a
 * scenario remains the only action that creates an effective price version.
 */
export default async function PriceScenariosPage() {
  const context = await getCostingReadContext();
  const db = getDb().db;
  const [rows, products, locations, channels] = await Promise.all([
    loadPriceScenarios(context),
    listProducts(createPostgresProductStore(db), { organizationId: context.organizationId }),
    listLocations(createPostgresInventoryStore(db), { organizationId: context.organizationId }),
    loadChannels(context),
  ]);
  const variantOptions = products.flatMap(({ product, variants }) =>
    variants.map((variant) => ({
      id: variant.id,
      label: `${product.code} · ${variant.name}`,
    })),
  );
  const currency = context.currency;
  const money = (value: string | null): string =>
    value === null ? "—" : `${formatMoney(value)}${currency === null ? "" : ` ${currency}`}`;

  return (
    <>
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
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: geometry.controlHeight.sm,
                          fontWeight: typography.fontWeight.semibold,
                        }}
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
      <RegisterScenarioForm
        variants={variantOptions}
        locations={locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        channels={channels.map((channel) => ({
          id: channel.id,
          code: channel.code,
          name: channel.name,
        }))}
        currency={currency}
        taxBases={TAX_BASES}
      />
    </>
  );
}
