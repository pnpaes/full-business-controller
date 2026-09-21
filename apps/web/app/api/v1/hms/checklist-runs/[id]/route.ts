import {
  createPostgresHmsStore,
  findChecklistRun,
  updateChecklistRun,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  HMS_CHECKLIST_RUN_READ_ROLES,
  HMS_CHECKLIST_RUN_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import { isUuid, parseUpdateChecklistRunBody, toChecklistRunRow } from "../../checklist-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One checklist run by id (`HMS-005`, `DEC-091`, `DEC-096`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). A run carries `location_id`, so this is the referenced-row path
 * (`incidents/[id]/route.ts:53-61`): the run is resolved org-scoped first —
 * unknown/missing → 404, a run at another location → 403 for a location-scoped
 * caller.
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
    if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const run = await findChecklistRun(store, { organizationId, runId: id });
    if (run === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_READ_ROLES, run.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ run: toChecklistRunRow(organizationId, run) });
  });
}

/**
 * Amends one checklist run (`HMS-005`, `DEC-091`). Amending is the same
 * operational act as recording, so the recording role set applies (`DEC-096`):
 * owner / general_manager / location_manager / kitchen / front_of_house / admin;
 * `analyst`/`purchasing`/`finance` are denied. The body is any subset of
 * `status`, `results` and `notes` (`null` clears the notes).
 *
 * A malformed body, a bad vocabulary value, a non-array `results`/bad item
 * `outcome` or a non-UUID id is a 400, as is a command rejection (no fields). An
 * unknown/cross-organization run is a 404; a location-scoped caller may only edit
 * a run at a location in their scope — resolved org-scoped before the command, so
 * another location's run is a 403.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateChecklistRun, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_RECORD_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateChecklistRunBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const run = await findChecklistRun(store, { organizationId, runId: id });
      if (run === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_RECORD_ROLES, run.locationId)) {
        return jsonError(403);
      }
    }

    let run;
    try {
      run = await updateChecklistRun(store, {
        organizationId,
        actorId: session.userId,
        runId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ run: toChecklistRunRow(organizationId, run) });
  });
}
