import {
  createPostgresDataQualityReadStore,
  createPostgresIntegrationSourceStore,
  createPostgresMasterDataStore,
  createPostgresTaxStore,
  listAuditEvents,
  listDataQualityExceptions,
  listIntegrationSources,
  listTaxRuleRegister,
  listUnits,
  listUsers,
  loadUserAccess,
} from "@aquarela/application";
import { color, spacing, typography } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import {
  ADMIN_AUDIT_READ_ROLES,
  ADMIN_DATA_QUALITY_READ_ROLES,
  ADMIN_INTEGRATIONS_ROLES,
  ADMIN_UNIT_READ_ROLES,
  ADMIN_USERS_ROLES,
  isAdministrationAuthorized,
} from "../../api/v1/administration/access";
import { TAX_RULE_READ_ROLES, isCostingAuthorized } from "../../api/v1/costing/access";

import { AreaCard } from "./area-card";

export const dynamic = "force-dynamic";

/**
 * Administration hub (08_UI_UX.md §8.3). One compact grid of area cards, each
 * with its headline count and a link to the area's own register screen; the
 * registers themselves live on the sub-routes. Every count is gated on the
 * caller's live roles (`loadUserAccess`, ADR-0003), so a role without read
 * sees no card rather than an empty register.
 */

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: spacing[4],
} as const;

export default async function AdministrationPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadUnits = isAdministrationAuthorized(access, ADMIN_UNIT_READ_ROLES);
  const canReadDataQuality = isAdministrationAuthorized(access, ADMIN_DATA_QUALITY_READ_ROLES);
  const canReadAudit = isAdministrationAuthorized(access, ADMIN_AUDIT_READ_ROLES);
  const canManageUsers = isAdministrationAuthorized(access, ADMIN_USERS_ROLES);
  const canReadIntegrations = isAdministrationAuthorized(access, ADMIN_INTEGRATIONS_ROLES);
  const canReadTaxRules = isCostingAuthorized(access, TAX_RULE_READ_ROLES);

  // Hub counts only: the registers themselves load on their own screens.
  const [units, exceptions, auditEvents, users, integrationSources, taxRules] = await Promise.all([
    canReadUnits ? listUnits(store, { organizationId }) : Promise.resolve([]),
    canReadDataQuality
      ? listDataQualityExceptions(createPostgresDataQualityReadStore(getDb().db), {
          organizationId,
        })
      : Promise.resolve([]),
    canReadAudit ? listAuditEvents(getAuthStore(), { organizationId }) : Promise.resolve([]),
    canManageUsers ? listUsers(getAuthStore(), { organizationId }) : Promise.resolve([]),
    canReadIntegrations
      ? listIntegrationSources(createPostgresIntegrationSourceStore(getDb().db), {
          organizationId,
        })
      : Promise.resolve([]),
    canReadTaxRules
      ? listTaxRuleRegister(createPostgresTaxStore(getDb().db), { organizationId })
      : Promise.resolve([]),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <div style={gridStyle}>
        {canManageUsers ? (
          <AreaCard
            href="/administration/users"
            title="Users & access"
            description="Who can sign in, the roles they hold and the locations they can see."
            count={users.length}
            countLabel={users.length === 1 ? "user" : "users"}
          />
        ) : null}
        {canReadIntegrations ? (
          <AreaCard
            href="/administration/integrations"
            title="Integrations"
            description="External systems this organization may exchange data with, and who owns the credentials."
            count={integrationSources.length}
            countLabel={integrationSources.length === 1 ? "source" : "sources"}
          />
        ) : null}
        {canReadTaxRules ? (
          <AreaCard
            href="/administration/tax-rules"
            title="Tax rules"
            description="Effective-dated rates per applicability and scope; a rate change is a new rule."
            count={taxRules.length}
            countLabel={taxRules.length === 1 ? "rule" : "rules"}
          />
        ) : null}
        {canReadUnits ? (
          <AreaCard
            href="/administration/units"
            title="Units & conversions"
            description="Units of measure and the org-wide factors between them."
            count={units.length}
            countLabel={units.length === 1 ? "unit" : "units"}
          />
        ) : null}
        {canReadDataQuality ? (
          <AreaCard
            href="/administration/data-quality"
            title="Data quality"
            description="Exceptions recorded by the completeness, freshness, reconciliation and variance rules."
            count={exceptions.length}
            countLabel={exceptions.length === 1 ? "exception" : "exceptions"}
          />
        ) : null}
        {canReadAudit ? (
          <AreaCard
            href="/administration/audit"
            title="Audit log"
            description="Every create, update, retire, post, approve, reject, reverse, close, export and security change."
            count={auditEvents.length}
            countLabel={auditEvents.length === 1 ? "event" : "events"}
          />
        ) : null}
      </div>

      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          fontSize: 14,
          color: color.text.secondary,
        }}
      >
        Sales imports live at{" "}
        <a
          href="/sales/import"
          style={{ color: color.brand.navy, fontWeight: typography.fontWeight.semibold }}
        >
          /sales/import
        </a>
        . Areas without a screen yet are not listed here; they appear as their screens are built.
      </p>
    </div>
  );
}
