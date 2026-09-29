import { createPostgresMasterDataStore, listUnits, loadUserAccess } from "@aquarela/application";
import { Badge, DataTable, EmptyState, color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  ADMIN_UNIT_READ_ROLES,
  isAdministrationAuthorized,
} from "../../../api/v1/administration/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Units & conversions — Administration" };

/**
 * Units of measure and the org-wide conversions between them. Units are
 * registered by the catalogue service (read-only here); a conversion is an
 * effective-dated factor between two units, created from the page's modal.
 * Gated on the caller's live roles (ADR-0003).
 */
export default async function AdministrationUnitsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadUnits = isAdministrationAuthorized(access, ADMIN_UNIT_READ_ROLES);
  if (!canReadUnits) {
    redirect("/administration");
  }

  const asOf = new Date();
  const conversions = await store.listEffectiveConversions(organizationId, asOf, null);
  const units = await listUnits(store, { organizationId });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <section
        style={{
          backgroundColor: color.background.surface,
          border: `1px solid ${color.border.subtle}`,
          borderRadius: radius["2xl"],
          padding: spacing[5],
        }}
      >
        <h2
          style={{
            margin: `0 0 ${spacing[4]}px`,
            fontFamily: "var(--font-sans), system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            color: color.text.primary,
          }}
        >
          Units
        </h2>
        {units.length === 0 ? (
          <EmptyState variant="plain" title="No units registered yet">
            Units of measure are registered by the catalogue service. None exist for this
            organization yet.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <DataTable
              caption="Units of measure registered for this organization, ordered by code."
              columns={[
                { key: "code", header: "Code" },
                { key: "dimension", header: "Dimension" },
                { key: "base", header: "Base unit" },
              ]}
              rows={units.map((unit) => ({
                code: unit.code,
                dimension: unit.dimension,
                base: unit.isBase ? <Badge>base</Badge> : "—",
              }))}
              emptyMessage="No units registered yet."
            />
          </div>
        )}
      </section>

      <section
        style={{
          backgroundColor: color.background.surface,
          border: `1px solid ${color.border.subtle}`,
          borderRadius: radius["2xl"],
          padding: spacing[5],
        }}
      >
        <h2
          style={{
            margin: `0 0 ${spacing[4]}px`,
            fontFamily: "var(--font-sans), system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            color: color.text.primary,
          }}
        >
          Conversions
        </h2>
        {conversions.length === 0 ? (
          <EmptyState variant="plain" title="No unit conversions defined">
            A conversion is an effective-dated factor between two units: 1 from-unit equals the
            factor times the to-unit. Register the org-wide conversions with New conversion;
            item-specific pack and density conversions live on the item detail screen.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <DataTable
              caption="Org-wide unit conversions effective now, resolved at the request time."
              columns={[
                { key: "from", header: "From" },
                { key: "to", header: "To" },
                { key: "factor", header: "Factor", align: "right" },
                { key: "effective", header: "Effective" },
              ]}
              rows={conversions.map((edge) => ({
                from: edge.fromUnit.code,
                to: edge.toUnit.code,
                factor: edge.factor,
                effective: `${edge.effectiveFrom.toISOString().slice(0, 10)} → ${
                  edge.effectiveTo === null ? "open" : edge.effectiveTo.toISOString().slice(0, 10)
                }`,
              }))}
              emptyMessage="No unit conversions defined."
            />
          </div>
        )}
      </section>
    </div>
  );
}
