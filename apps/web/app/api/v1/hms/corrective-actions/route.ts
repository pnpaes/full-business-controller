import { createPostgresHmsStore, findIncident, listCorrectiveActions } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { HMS_CORRECTIVE_ACTION_READ_ROLES, isHmsAuthorized, loadHmsAccess } from "../access";
import { parseCorrectiveActionListQuery, toCorrectiveActionRows } from "../incident-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Corrective actions across the served organization (`HMS-004`, `DEC-090`),
 * earliest `dueDate` first.
 *
 * Query: optional `incidentId` (UUID), `status`, `ownerId` (UUID), plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside the read set → 403; a malformed filter → 400. Never
 * returns another organization's actions (`DEC-061`).
 *
 * A corrective action carries no `location_id`, so a location-scoped caller
 * cannot be constrained by a plain read: such a caller **must** name an
 * `incidentId` (403 without one), and the incident is then resolved org-scoped —
 * unknown/missing → 404, another location's → 403 — before its actions are
 * listed. An unscoped caller may list freely.
 *
 * ponytail: the scope check is incident-derived because `corrective_action` has
 * no `location_id`. The ceiling is a mandatory filter plus an extra
 * `findIncident` round-trip, and reading-linked actions cannot be listed by a
 * scoped caller; the upgrade path is a denormalized `location_id` on the action
 * or a location-joined query.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCorrectiveActionListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      if (parsed.query.incidentId === undefined) {
        return jsonError(403);
      }
      const incident = await findIncident(store, {
        organizationId,
        incidentId: parsed.query.incidentId,
      });
      if (incident === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES, incident.locationId)) {
        return jsonError(403);
      }
    }

    const actions = await listCorrectiveActions(store, {
      organizationId,
      ...(parsed.query.incidentId === undefined ? {} : { incidentId: parsed.query.incidentId }),
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(parsed.query.ownerId === undefined ? {} : { ownerId: parsed.query.ownerId }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toCorrectiveActionRows(organizationId, actions),
    });
  });
}
