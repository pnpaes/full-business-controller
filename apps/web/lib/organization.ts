import { ConfigError } from "@aquarela/config";

/**
 * Single application-layer organization seam, per the multi-tenancy brief
 * (`docs/phase0/MULTITENANCY_POSTURE.md` §5): the auth commands are org-scoped,
 * so the web layer pins the one organization this install serves instead of
 * accepting a tenant from the caller. Replacing this function's body with a real
 * tenant resolver is the later shared-multi-tenant path; no schema change is
 * needed then.
 */
export function resolveOrganization(): string {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  if (organizationId === undefined || organizationId.length === 0) {
    throw new ConfigError("ORGANIZATION_ID is not set");
  }
  return organizationId;
}
