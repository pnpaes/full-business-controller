import {
  createPostgresSchedulingStore,
  findShift,
  findShiftAssignment,
  withdrawShiftAssignment,
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
  isWorkforceAuthorized,
  loadWorkforceAccess,
  SHIFT_READ_ROLES,
  SHIFT_WRITE_ROLES,
} from "../../access";
import { shiftLimiters } from "../../limiters";
import { isUuid, toShiftAssignmentRow } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One shift assignment by id (`WF-003`, `DEC-037`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * assignment is resolved organization-scoped first — unknown/cross-organization
 * → 404 (`DEC-061`) — then its shift is loaded (a missing shift → 404) and the
 * shift's location scope is checked (403 for a scoped caller's foreign shift).
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

    const assignment = await findShiftAssignment(store, {
      organizationId,
      shiftAssignmentId: id,
    });
    if (assignment === undefined) {
      return jsonError(404);
    }
    const shift = await findShift(store, { organizationId, shiftId: assignment.shiftId });
    if (shift === undefined) {
      return jsonError(404);
    }
    if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ shiftAssignment: toShiftAssignmentRow(organizationId, assignment) });
  });
}

/**
 * Withdraws one approved shift assignment (`WF-003`, `DEC-037`) — the only
 * transition exposed here. Limited to owner / general_manager / location_manager
 * / admin; the actor is the session user.
 *
 * The body must be exactly `{ state: "withdrawn" }`: any other value (including
 * another `SHIFT_ASSIGNMENT_STATES` member) is a 400. A non-UUID id is a 400.
 * The assignment is resolved org-scoped first — unknown/cross-organization →
 * 404 — then its shift is loaded (missing → 404) and the shift's location scope
 * is checked (403). Only an `approved` assignment may be withdrawn; any other
 * state is a command `DomainError` → 400.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.withdrawShiftAssignment, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    if (body === undefined || body.state !== "withdrawn") {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    const assignment = await findShiftAssignment(store, {
      organizationId,
      shiftAssignmentId: id,
    });
    if (assignment === undefined) {
      return jsonError(404);
    }
    const shift = await findShift(store, { organizationId, shiftId: assignment.shiftId });
    if (shift === undefined) {
      return jsonError(404);
    }
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    let updated;
    try {
      updated = await withdrawShiftAssignment(store, {
        organizationId,
        shiftAssignmentId: id,
        actorId: session.userId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ shiftAssignment: toShiftAssignmentRow(organizationId, updated) });
  });
}
