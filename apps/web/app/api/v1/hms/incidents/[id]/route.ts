import { createPostgresHmsStore, findIncident, updateIncident } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  HMS_INCIDENT_EDIT_ROLES,
  HMS_INCIDENT_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import { isUuid, parseUpdateIncidentBody, toIncidentRow } from "../../incident-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One incident by id (`HMS-003`, `DEC-090`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). This is the referenced-row path
 * (`monitoring-points/[id]/readings/route.ts:68-76`): for a location-scoped
 * caller the incident is resolved org-scoped first — unknown/missing → 404,
 * an incident at another location → 403.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const incident = await findIncident(store, { organizationId, incidentId: id });
    if (incident === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES, incident.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ incident: toIncidentRow(organizationId, incident) });
  });
}

/**
 * Amends or closes/reopens one incident (`HMS-003`, `DEC-090`). The actor is the
 * session user. Closing/reopening is an edit, so kitchen/front_of_house — which
 * may create and read — are denied here (`DEC-095`), as are `analyst`/`finance`/
 * `purchasing`.
 *
 * The body is any subset of `status`, `severity`, `ownerId`, `dueDate`, `title`
 * and `description` (`null` clears an optional field); `closedAt` is derived by
 * the command from `status`. A malformed body or a non-UUID id is a 400, as is a
 * command rejection (unknown status/severity, empty title, no fields). An
 * unknown/cross-organization incident is a 404; a location-scoped caller may
 * only edit an incident at a location in their scope — resolved org-scoped
 * before the command, so another location's incident is a 403.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateIncident, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateIncidentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const incident = await findIncident(store, { organizationId, incidentId: id });
      if (incident === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES, incident.locationId)) {
        return jsonError(403);
      }
    }

    let incident;
    try {
      incident = await updateIncident(store, {
        organizationId,
        actorId: session.userId,
        incidentId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ incident: toIncidentRow(organizationId, incident) });
  });
}
