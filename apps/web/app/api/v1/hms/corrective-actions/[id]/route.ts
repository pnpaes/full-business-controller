import {
  createPostgresHmsStore,
  findCorrectiveAction,
  findIncident,
  updateCorrectiveAction,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";

import {
  HMS_CORRECTIVE_ACTION_EDIT_ROLES,
  HMS_CORRECTIVE_ACTION_VERIFY_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import {
  isUuid,
  parseUpdateCorrectiveActionBody,
  toCorrectiveActionRow,
} from "../../incident-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Amends or advances one corrective action (`HMS-004`, `DEC-090`). The actor is
 * the session user. An operator (kitchen / front_of_house) may move an action to
 * `in_progress`/`done` but never `verified`: setting `status: "verified"`
 * additionally requires owner / general_manager / location_manager / admin
 * (`HMS_CORRECTIVE_ACTION_VERIFY_ROLES`, `DEC-095`).
 *
 * The body is any subset of `status`, `ownerId`, `dueDate` and `description`
 * (`null` clears an optional field). A malformed body or a non-UUID id is a 400,
 * as is a command rejection (unknown status, empty description, no fields). The
 * `completedAt`/`verifiedBy`/`verifiedAt` companions are derived by the command
 * from `status`.
 *
 * The action carries no `location_id`, so a location-scoped caller's scope is
 * derived from the incident: the action is resolved org-scoped (unknown/missing
 * → 404), then the incident it links to is resolved org-scoped — unknown/missing
 * → 404, another location's → 403. A reading-linked action (no `incident_id`)
 * cannot be scope-checked and is denied to a scoped caller (403, fail closed).
 *
 * ponytail: the incident-derived scope check costs an extra `findCorrectiveAction`
 * + `findIncident` pair and blocks scoped callers from reading-linked actions;
 * the upgrade path is a denormalized `location_id` on the action or a
 * location-joined query.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateCorrectiveAction, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_EDIT_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateCorrectiveActionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (
      parsed.input.status === "verified" &&
      !isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_VERIFY_ROLES)
    ) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const action = await findCorrectiveAction(store, {
        organizationId,
        correctiveActionId: id,
      });
      if (action === undefined) {
        return jsonError(404);
      }
      if (action.incidentId === null) {
        return jsonError(403);
      }
      const incident = await findIncident(store, {
        organizationId,
        incidentId: action.incidentId,
      });
      if (incident === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_EDIT_ROLES, incident.locationId)) {
        return jsonError(403);
      }
    }

    let action;
    try {
      action = await updateCorrectiveAction(store, {
        organizationId,
        actorId: session.userId,
        correctiveActionId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ correctiveAction: toCorrectiveActionRow(organizationId, action) });
  });
}
