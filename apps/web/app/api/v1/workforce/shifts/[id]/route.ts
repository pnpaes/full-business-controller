import { createPostgresSchedulingStore, findShift, updateShift } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  SHIFT_READ_ROLES,
  SHIFT_WRITE_ROLES,
} from "../../access";
import { shiftLimiters } from "../../limiters";
import { isUuid, parseUpdateShiftBody, toShiftRow } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One shift by id (`WF-002`, `DEC-037`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). For a location-scoped caller the shift is resolved org-scoped
 * first — unknown/missing → 404 — then the scope is checked: a shift at another
 * location is a 403. `shift.location_id` is NOT NULL, so the row's location is
 * always available to check.
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
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);
    const shift = await findShift(store, { organizationId, shiftId: id });
    if (shift === undefined) {
      return jsonError(404);
    }
    if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ shift: toShiftRow(organizationId, shift) });
  });
}

/**
 * Amends one planned shift's window, break or role (`WF-002`, `DEC-037`). The
 * body is any subset of `startsAt`, `endsAt`, `breakMinutes` and `roleCode`
 * (`null`/blank clears the role); the lifecycle (`state`) is owned by
 * publish/cancel/complete. The actor is the session user.
 *
 * A non-UUID id or a malformed body is a 400, as is a command rejection
 * (`endsAt` not after `startsAt`, a terminal state, an empty patch). For a
 * location-scoped caller the shift is resolved org-scoped first — unknown/
 * cross-organization → 404 — then the scope is checked (403 at another
 * location). A shift that vanished between the load and the command is a typed
 * `NotFoundError` → 404.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.updateShift, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateShiftBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    const shift = await findShift(store, { organizationId, shiftId: id });
    if (shift === undefined) {
      return jsonError(404);
    }
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    let updated;
    try {
      updated = await updateShift(store, {
        organizationId,
        actorId: session.userId,
        shiftId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ shift: toShiftRow(organizationId, updated) });
  });
}
