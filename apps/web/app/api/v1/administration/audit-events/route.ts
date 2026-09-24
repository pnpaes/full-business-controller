import { listAuditEvents } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getAuthStore } from "../../../../../lib/auth";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  ADMIN_AUDIT_READ_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../access";
import { parseAuditQuery, toAuditEventRow } from "../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit register for the served organization (`07_SECURITY_AND_NFR.md` §7.3),
 * newest `occurred_at` first. Read-only: the table is append-only and this route
 * exposes no mutation.
 *
 * Query: optional `entityType`, `entityId` (uuid), `action`, `actorId` (uuid),
 * `from`/`to` (ISO instants) plus `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside
 * `ADMIN_AUDIT_READ_ROLES` (owner / general_manager / admin) → 403; a malformed
 * filter or page → 400. Never returns another organization's events
 * (`DEC-061`). The before/after diffs are not returned.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_AUDIT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseAuditQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = getAuthStore();

    let rows;
    try {
      rows = await listAuditEvents(store, {
        organizationId,
        ...(parsed.query.entityType === undefined ? {} : { entityType: parsed.query.entityType }),
        ...(parsed.query.entityId === undefined ? {} : { entityId: parsed.query.entityId }),
        ...(parsed.query.action === undefined ? {} : { action: parsed.query.action }),
        ...(parsed.query.actorId === undefined ? {} : { actorId: parsed.query.actorId }),
        ...(parsed.query.from === undefined ? {} : { from: parsed.query.from }),
        ...(parsed.query.to === undefined ? {} : { to: parsed.query.to }),
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      // `listAuditEvents` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: rows.map(toAuditEventRow),
    });
  });
}
