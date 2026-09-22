import {
  assignShift,
  createPostgresSchedulingStore,
  findShift,
  listShiftAssignments,
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
  isWorkforceAuthorized,
  loadWorkforceAccess,
  SHIFT_READ_ROLES,
  SHIFT_WRITE_ROLES,
} from "../../../access";
import { shiftLimiters } from "../../../limiters";
import {
  isUuid,
  parseCreateShiftAssignmentBody,
  parseShiftAssignmentListQuery,
  toShiftAssignmentRow,
  toShiftAssignmentRows,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The assignments of one shift (`WF-003`, `DEC-037`), ordered by `assignedAt`
 * then id.
 *
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the read set → 403; a non-UUID id or malformed paging → 400. The
 * shift is resolved organization-scoped first, so an unknown or
 * cross-organization shift id is a 404 (`DEC-061`); a location-scoped caller is
 * checked against the shift's location (403 at another location).
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
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseShiftAssignmentListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
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

    const assignments = await listShiftAssignments(store, {
      organizationId,
      shiftId: id,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toShiftAssignmentRows(organizationId, assignments),
    });
  });
}

/**
 * Assigns one employee to the shift in the path (`WF-003`, `DEC-037`). Limited
 * to owner / general_manager / location_manager / admin; the actor is the
 * session user and the shift link is the path id, so the body carries only
 * `employeeId`.
 *
 * A non-UUID id, a malformed body (missing/non-UUID `employeeId`) is a 400. The
 * shift is resolved organization-scoped first — unknown/cross-organization →
 * 404 — then the scope is checked (403 at another location). Command
 * rejections (a shift not `open`/`published`, an employee at another location,
 * a duplicate assignment) are `DomainError`s → 400; a missing employee is a
 * `NotFoundError` → 404.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.assignShift, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCreateShiftAssignmentBody(await readJsonObject(request));
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

    let assignment;
    try {
      assignment = await assignShift(store, {
        organizationId,
        shiftId: id,
        employeeId: parsed.input.employeeId,
        actorId: session.userId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ shiftAssignment: toShiftAssignmentRow(organizationId, assignment) });
  });
}
