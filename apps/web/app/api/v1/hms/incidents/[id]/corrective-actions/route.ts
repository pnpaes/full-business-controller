import {
  createPostgresHmsStore,
  findIncident,
  listCorrectiveActions,
  recordCorrectiveAction,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { getServerSession } from "../../../../../../../lib/server-session";

import {
  HMS_CORRECTIVE_ACTION_CREATE_ROLES,
  HMS_CORRECTIVE_ACTION_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../access";
import {
  isUuid,
  parseCorrectiveActionListQuery,
  parseCreateCorrectiveActionBody,
  toCorrectiveActionRows,
} from "../../../incident-rows";
import { hmsLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Corrective actions recorded against one incident (`HMS-004`, `DEC-090`),
 * earliest `dueDate` first.
 *
 * Query: optional `status`/`ownerId` (on top of the path's incident) and
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`.
 * Signed out → 401; a role outside the read set → 403; a non-UUID id or a
 * malformed page → 400. An action carries no `location_id`, so a
 * location-scoped caller's scope is derived from the incident
 * (`monitoring-points/[id]/readings/route.ts:68-76`): the incident is resolved
 * org-scoped — unknown/missing → 404, another location's → 403 — and only then
 * are its actions listed. An unscoped caller with no incident filter is
 * organization-scoped by the store (`DEC-061`).
 *
 * ponytail: scope is resolved through the incident on every request because
 * `corrective_action` has no `location_id` (it may hang off an incident or a
 * monitoring reading). The ceiling is an extra `findIncident` round-trip and a
 * 403 for a scoped caller on a reading-linked action; the upgrade path is a
 * denormalized `location_id` on the action or a location-joined query.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCorrectiveActionListQuery(new URL(request.url).searchParams);
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
      if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES, incident.locationId)) {
        return jsonError(403);
      }
    }

    const actions = await listCorrectiveActions(store, {
      organizationId,
      incidentId: id,
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

/**
 * Records a corrective action against the incident in the path (`HMS-004`,
 * `DEC-090`) — create is limited to owner / general_manager / location_manager /
 * admin (`DEC-095`). The actor is the session user; the incident link is the
 * path id, so the body can only carry `description` and the optional
 * `ownerId`/`dueDate`. A malformed body or a non-UUID id is a 400.
 *
 * The incident is resolved org-scoped for every caller — an unknown or
 * cross-organization id is a 404 (the command has no incident lookup of its
 * own, so without this a nonexistent link would surface as a raw FK error) and
 * a location-scoped caller may only add to an incident at a location in their
 * scope (403).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.recordCorrectiveAction, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_CREATE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCreateCorrectiveActionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    const incident = await findIncident(store, { organizationId, incidentId: id });
    if (incident === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_CREATE_ROLES, incident.locationId)) {
      return jsonError(403);
    }

    let action;
    try {
      action = await recordCorrectiveAction(store, {
        organizationId,
        actorId: session.userId,
        incidentId: id,
        description: parsed.input.description,
        ownerId: parsed.input.ownerId,
        dueDate: parsed.input.dueDate,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ correctiveActionId: action.id, status: action.status });
  });
}
