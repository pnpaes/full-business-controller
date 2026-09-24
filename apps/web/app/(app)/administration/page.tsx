import { createPostgresMasterDataStore } from "@aquarela/application";
import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { UnitConversionForm } from "./unit-conversion-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration — Aquarela Business Control" };

/**
 * Administration hub (08_UI_UX.md §8.3: users/scopes, tax/rules, units,
 * imports, integrations, audit and data quality). Only capabilities with an
 * existing screen and application service are linked — Imports today. The
 * remaining domains have no application read service and no route yet, so they
 * are listed as unavailable instead of offering controls that do nothing.
 * No backend was added in this wave.
 */

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
} as const;

const list = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: spacing[2],
  color: color.text.secondary,
  fontSize: typography.fontSize.md,
} as const;

const link = {
  color: color.brand.navy,
  fontWeight: typography.fontWeight.semibold,
} as const;

const backLink = {
  ...link,
  alignSelf: "flex-start",
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
} as const;

const muted = {
  color: color.text.secondary,
} as const;

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}

export default async function AdministrationPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const asOf = new Date();
  const conversions = await store.listEffectiveConversions(organizationId, asOf, null);
  const knownCodes = [
    ...new Set(conversions.flatMap((edge) => [edge.fromUnit.code, edge.toUnit.code])),
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Administration"
        scope="Aquarela Business Control"
        description="Configuration and oversight areas. Only capabilities with an existing screen are linked; the rest stay listed with the reason they are not available yet."
      />
      <SectionCard title="Available" meta="Linked screens">
        <ul style={list}>
          <li>
            <a href="/sales/import" style={link}>
              Imports
            </a>{" "}
            — sales import history: register, stage, validate, map and preview runs at{" "}
            <span style={muted}>/sales/import</span>.
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="Units & conversions" meta={`${conversions.length} effective · FND-003`}>
        {conversions.length === 0 ? (
          <EmptyState title="No unit conversions defined">
            A conversion is an effective-dated factor between two units (1 <em>from</em> = factor ×{" "}
            <em>to</em>). Add the org-wide conversions below; item-specific pack/density conversions
            live on the item detail screen.
          </EmptyState>
        ) : (
          <Table
            caption="Org-wide unit conversions effective now, resolved at the request time."
            columnCount={4}
          >
            <thead>
              <tr>
                <Th>From</Th>
                <Th>To</Th>
                <Th style={numCell}>Factor</Th>
                <Th>Effective</Th>
              </tr>
            </thead>
            <tbody>
              {conversions.map((edge) => (
                <tr
                  key={`${edge.fromUnit.id}:${edge.toUnit.id}:${edge.effectiveFrom.toISOString()}`}
                >
                  <Td>{edge.fromUnit.code}</Td>
                  <Td>{edge.toUnit.code}</Td>
                  <Td style={numCell}>{trimDecimal(edge.factor)}</Td>
                  <Td>
                    {edge.effectiveFrom.toISOString().slice(0, 10)}
                    {" → "}
                    {edge.effectiveTo === null
                      ? "open"
                      : edge.effectiveTo.toISOString().slice(0, 10)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <details style={{ marginTop: spacing[4] }}>
          <summary
            style={{
              cursor: "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New conversion
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <UnitConversionForm knownCodes={knownCodes} />
          </div>
        </details>
      </SectionCard>

      <SectionCard title="Not available yet" headingLevel={3} meta="No backend">
        <ul style={list}>
          <li>
            <Badge>No backend</Badge> Users/scopes — no user, role or location scope management
            service or screen exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Tax/rules — no tax or rule configuration service or screen
            exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Units — unit registration exists in the catalog service, and
            the org-wide conversion graph is listed and extended in the section above; there is
            still no read service to list the units themselves, so they stay unlisted.
          </li>
          <li>
            <Badge>No backend</Badge> Integrations — no integration configuration service or screen
            exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Audit — events can only be written by other slices; there is
            no read service or screen to review them yet.
          </li>
          <li>
            <Badge>No backend</Badge> Data quality — exceptions can only be recorded by other
            slices; there is no read service or screen to review them yet.
          </li>
        </ul>
      </SectionCard>
      <a href="/" style={backLink}>
        Back to Management home
      </a>
    </div>
  );
}
