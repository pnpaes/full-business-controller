import {
  createPostgresCostingReadStore,
  createPostgresInventoryStore,
  createPostgresTaxStore,
  listChannels,
  listLocations,
  listTaxRuleRegister,
  loadUserAccess,
} from "@aquarela/application";
import { color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { TAX_RULE_READ_ROLES, isCostingAuthorized } from "../../../api/v1/costing/access";
import { toChannelRows } from "../../../api/v1/costing/costing-views";
import { TAX_RULE_WRITE_ROLES } from "../../../api/v1/costing/tax-rules/access";

import { TaxRuleForm } from "../tax-rule-form";
import { TaxRuleRegister, type TaxRuleRow } from "../tax-rule-register";
import { fractionToPercentDisplay, taxScopeLabel } from "../tax-rule-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax rules — Administration" };

/** Effective status of a rule at the page's single stated `asOf` (half-open window). */
function effectiveStatusAt(
  effectiveFrom: string,
  effectiveTo: string | null,
  asOfIso: string,
): "effective" | "future" | "ended" {
  if (effectiveFrom > asOfIso) {
    return "future";
  }
  return effectiveTo !== null && effectiveTo <= asOfIso ? "ended" : "effective";
}

/**
 * The tax-rule register: effective-dated rates per applicability and scope.
 * The list is append-only — a rate change is a new rule from a date, and the
 * only mutation on an existing rule is ending it. Both reads are org-scoped
 * (DEC-061); the register carries the effective windows so the status is
 * computed at this page's single stated `asOf`.
 */
export default async function AdministrationTaxRulesPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadTaxRules = isCostingAuthorized(access, TAX_RULE_READ_ROLES);
  const canWriteTaxRules = isCostingAuthorized(access, TAX_RULE_WRITE_ROLES);
  if (!canReadTaxRules && !canWriteTaxRules) {
    redirect("/administration");
  }

  const taxRules = canReadTaxRules
    ? await listTaxRuleRegister(createPostgresTaxStore(getDb().db), { organizationId })
    : [];
  // The register (read) needs the channel/location names to label a scoped rule,
  // so these load whenever the page is visible, not only for writers.
  const taxChannels = await listChannels(createPostgresCostingReadStore(getDb().db), {
    organizationId,
    limit: 200,
  });
  const taxLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const taxAsOf = new Date().toISOString();
  const channelLabelById = new Map(
    taxChannels.flatMap((channel) =>
      toChannelRows(organizationId, [channel]).map(
        (row) => [row.id, `${row.code} · ${row.name}`] as const,
      ),
    ),
  );
  const locationLabelById = new Map(taxLocations.map((location) => [location.id, location.name]));
  const taxRuleRows: TaxRuleRow[] = taxRules.map((rule) => ({
    id: rule.id,
    code: rule.code,
    name: rule.name,
    ratePct: rule.ratePct,
    taxBasis: rule.taxBasis,
    taxTreatment: rule.taxTreatment,
    recoverable: rule.recoverable,
    ratePercent: fractionToPercentDisplay(rule.ratePct),
    appliesTo: rule.appliesTo,
    scopeType: rule.scopeType,
    scopeLabel: taxScopeLabel(rule, channelLabelById, locationLabelById),
    effectiveStatus: effectiveStatusAt(
      rule.effectiveFrom.toISOString(),
      rule.effectiveTo === null ? null : rule.effectiveTo.toISOString(),
      taxAsOf,
    ),
    effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: rule.effectiveTo === null ? null : rule.effectiveTo.toISOString().slice(0, 10),
  }));

  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        padding: spacing[5],
      }}
    >
      <TaxRuleRegister rows={taxRuleRows} canWrite={canWriteTaxRules} />
      {canWriteTaxRules ? (
        <div style={{ marginTop: spacing[4] }}>
          <TaxRuleForm
            channels={toChannelRows(organizationId, taxChannels)}
            locations={taxLocations.map((location) => ({
              id: location.id,
              code: location.code,
              name: location.name,
            }))}
          />
        </div>
      ) : null}
    </section>
  );
}
