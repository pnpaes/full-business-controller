import {
  createPostgresIntegrationSourceStore,
  listIntegrationSources,
  registerIntegrationSource,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  ADMIN_INTEGRATIONS_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../access";
import {
  parseIntegrationSourceBody,
  parseIntegrationSourcesQuery,
  toIntegrationSourceRow,
} from "../admin-rows";
import { administrationLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The served organization's integration-source registry (`INTG-001`,
 * `DEC-137`, `ADR-0011`), ordered by `name`, one bounded page. Response
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside
 * `ADMIN_INTEGRATIONS_ROLES` (owner / admin) → 403; a malformed page → 400.
 * Never returns another organization's rows (`DEC-061`). The registry is
 * configuration only — `INTG-002` publishing is not built here.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_INTEGRATIONS_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseIntegrationSourcesQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresIntegrationSourceStore(getDb().db);

    let rows;
    try {
      rows = await listIntegrationSources(store, {
        organizationId,
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      // `listIntegrationSources` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: rows.map(toIntegrationSourceRow),
    });
  });
}

/**
 * Registers one integration source (`INTG-001`, `DEC-137`). The organization
 * and actor come from the session, never the body; the command remains the
 * single validator of the vocabularies, the `ALLOWED_OPERATION` subset, the
 * duplicate name and the `DEC-015` invariant that a write operation requires
 * `terms_status = 'approved'`. A `DomainError` maps to 400.
 *
 * Guard order: same-origin + throttle (`withMutationGuards`), then session →
 * role → body parse. Configuring a source is governance-level, so the write set
 * is `ADMIN_INTEGRATIONS_ROLES` (owner / admin).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, administrationLimiters.createIntegrationSource, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_INTEGRATIONS_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseIntegrationSourceBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresIntegrationSourceStore(getDb().db);
    try {
      const result = await registerIntegrationSource(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.fields,
      });
      return jsonOk({ integrationSourceId: result.integrationSourceId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
