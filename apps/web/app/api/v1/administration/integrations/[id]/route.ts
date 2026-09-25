import {
  createPostgresIntegrationSourceStore,
  updateIntegrationSource,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  ADMIN_INTEGRATIONS_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../../access";
import { isUuid, parseIntegrationSourceBody } from "../../admin-rows";
import { administrationLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Updates one organization-owned integration source (`INTG-001`, `DEC-137`).
 * The body is the full editable field set (`name`, `systemType`, `direction`,
 * `allowedOperations`, `credentialsOwner`, `rateLimitNote`, `termsStatus`,
 * `active`); the organization and actor come from the session, never the body.
 * The command remains the single validator, including the `DEC-015` invariant
 * that a write operation requires `terms_status = 'approved'`.
 *
 * Guard order: same-origin + throttle (`withMutationGuards`), then session →
 * role → UUID check → body parse. A non-UUID id or malformed body → 400; an
 * unknown or cross-organization id → 404 before any write (`DEC-061`); a
 * command `DomainError` → 400. `INTG-002` publishing is not built here.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, administrationLimiters.updateIntegrationSource, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_INTEGRATIONS_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseIntegrationSourceBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresIntegrationSourceStore(getDb().db);

    const existing = await store.findIntegrationSourceById(organizationId, id);
    if (existing === undefined) {
      return jsonError(404);
    }

    try {
      await updateIntegrationSource(store, {
        organizationId,
        actorId: session.userId,
        integrationSourceId: id,
        ...parsed.fields,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ integrationSourceId: id });
  });
}
