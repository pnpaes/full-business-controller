import {
  createPostgresIntegrationSourceStore,
  listIntegrationSources,
  loadUserAccess,
} from "@aquarela/application";
import { color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  ADMIN_INTEGRATIONS_ROLES,
  isAdministrationAuthorized,
} from "../../../api/v1/administration/access";
import { toIntegrationSourceRow } from "../../../api/v1/administration/admin-rows";

import { IntegrationRegister } from "../integration-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations — Administration" };

/**
 * The integration-source registry: configuration only. It records who owns
 * the credentials, what data may move and whether the source's terms are
 * approved; publishing execution is not built, and a write operation stays
 * disabled until the source's terms are approved. Gated on the caller's live
 * roles (ADR-0003).
 */
export default async function AdministrationIntegrationsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadIntegrations = isAdministrationAuthorized(access, ADMIN_INTEGRATIONS_ROLES);
  if (!canReadIntegrations) {
    redirect("/administration");
  }

  const integrationSources = await listIntegrationSources(
    createPostgresIntegrationSourceStore(getDb().db),
    { organizationId },
  );

  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        padding: spacing[5],
      }}
    >
      <IntegrationRegister
        rows={integrationSources.map(toIntegrationSourceRow)}
        canWrite={canReadIntegrations}
      />
    </section>
  );
}
