import {
  createPostgresSchedulingStore,
  createShiftAdjustment,
  findShift,
  findShiftAssignment,
  listShiftAdjustments,
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
  WORKED_HOURS_READ_ROLES,
  WORKED_HOURS_WRITE_ROLES,
} from "../../../access";
import { shiftLimiters } from "../../../limiters";
import {
  isUuid,
  parseCreateShiftAdjustmentBody,
  parseShiftAdjustmentListQuery,
  toShiftAdjustmentRow,
  toShiftAdjustmentRows,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The recorded hour corrections of one shift assignment (`WF-004`), newest
 * first.
 *
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the read set (`WORKED_HOURS_READ_ROLES`) → 403; a non-UUID id or
 * malformed paging → 400. `adjustedHours` is payroll-input data, so the read
 * set is the narrower worked-hours one (`kitchen`/`front_of_house` may read the
 * rota but must not read the hours feeding payroll). The assignment is resolved
 * organization-scoped first, then its shift (a missing assignment or shift →
 * 404, `DEC-061`) and the shift's location scope is checked (403 for a scoped
 * caller's foreign shift).
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
    if (!isWorkforceAuthorized(access, WORKED_HOURS_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseShiftAdjustmentListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
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
    if (!isWorkforceAuthorized(access, WORKED_HOURS_READ_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    const adjustments = await listShiftAdjustments(store, {
      organizationId,
      shiftAssignmentId: id,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toShiftAdjustmentRows(organizationId, adjustments),
    });
  });
}

/**
 * Records one hour correction against the assignment in the path (`WF-004`).
 * Recording a correction is a payroll-input action, so it is limited to
 * `WORKED_HOURS_WRITE_ROLES` (owner / general_manager / location_manager /
 * finance / admin); the actor is the session user and the assignment link is
 * the path id, so the body carries only `adjustedHours` and `reason`.
 *
 * A non-UUID id or a malformed body (a float/negative/3-decimal or out-of-range
 * `adjustedHours`, a blank `reason`) is a 400 from the parser, as is a command
 * rejection (`DomainError`). The assignment is resolved organization-scoped
 * first — an unknown/cross-organization assignment or its missing shift → 404 —
 * then the shift's location scope is checked (403). A missing assignment
 * surfaced by the command is a `NotFoundError` → 404.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.createShiftAdjustment, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKED_HOURS_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCreateShiftAdjustmentBody(await readJsonObject(request));
    if (!parsed.ok) {
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
    if (!isWorkforceAuthorized(access, WORKED_HOURS_WRITE_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    let adjustment;
    try {
      adjustment = await createShiftAdjustment(store, {
        organizationId,
        shiftAssignmentId: id,
        adjustedHours: parsed.input.adjustedHours,
        reason: parsed.input.reason,
        actorId: session.userId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ shiftAdjustment: toShiftAdjustmentRow(organizationId, adjustment) });
  });
}
