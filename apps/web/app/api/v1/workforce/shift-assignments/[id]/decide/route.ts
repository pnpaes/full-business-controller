import {
  createPostgresSchedulingStore,
  decideSelfAssignment,
  findShift,
  findShiftAssignment,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { isWorkforceAuthorized, loadWorkforceAccess, SHIFT_WRITE_ROLES } from "../../../access";
import { shiftLimiters } from "../../../limiters";
import {
  isUuid,
  parseDecideSelfAssignmentBody,
  toShiftAssignmentRow,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A manager approves or rejects a pending self-assignment (`WF-003`,
 * `DEC-146`). The body is `{ decision: "approved" | "rejected", reason? }`;
 * `reason` is required for a rejection (a blank one is a command `DomainError`
 * → 400). Restricted to the shift write roles (owner / general_manager /
 * location_manager / admin); `SHIFT_WRITE_ROLES` is unchanged.
 *
 * Signed out → 401; a role outside the write set → 403; a non-UUID id or a
 * malformed body → 400. The assignment is resolved organization-scoped first
 * (unknown/cross-organization → 404), then its shift (missing → 404) and the
 * shift's location scope are checked (403). Only a `pending_approval` row may be
 * decided (any other state → 400); approval also requires the shift to still be
 * `open`/`published`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.decideSelfAssignment, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseDecideSelfAssignmentBody(await readJsonObject(request));
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
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    let updated;
    try {
      updated = await decideSelfAssignment(store, {
        organizationId,
        actorId: session.userId,
        assignmentId: id,
        decision: parsed.input.decision,
        ...(parsed.input.reason === undefined ? {} : { reason: parsed.input.reason }),
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
