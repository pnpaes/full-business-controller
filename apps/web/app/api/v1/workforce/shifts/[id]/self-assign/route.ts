import {
  createPostgresSchedulingStore,
  findSelfEmployee,
  selfAssignShift,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getConfig } from "../../../../../../../lib/config";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { shiftLimiters } from "../../../limiters";
import { isUuid, toShiftAssignmentRow } from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A linked employee self-assigns the shift in the path (`WF-003`, `DEC-146`).
 * There is **no role gate** beyond the employee link: any authenticated session
 * whose `app_user` resolves to exactly one employee row may call it. A signed-out
 * session → 401; an account with no linked employee row (or an ambiguous link)
 * → 403; a non-UUID id → 400.
 *
 * The command resolves the employee and applies the rules — the shift must be
 * `open`/`published`, the employee's primary location and role must match, no
 * duplicate assignment, and the weekly maximum (env `SELF_ASSIGN_WEEKLY_LIMIT`,
 * default 2) must not be exceeded. The assignment opens as `pending_approval`
 * with no `assigned_by`; the shift is not moved to `assigned` until a manager
 * approves it. Command rejections are `DomainError`s → 400 (a missing shift or
 * employee is a `NotFoundError` → 404).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.selfAssignShift, async () => {
    const { session } = await requireSession(request);

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    // Fail closed outside the employee's own rows: an account with no (or an
    // ambiguous) employee link is refused before the command runs.
    const employee = await findSelfEmployee(store, {
      organizationId,
      actorUserId: session.userId,
    });
    if (employee === undefined) {
      return jsonError(403);
    }

    let assignment;
    try {
      assignment = await selfAssignShift(store, {
        organizationId,
        actorUserId: session.userId,
        shiftId: id,
        weeklyLimit: getConfig().SELF_ASSIGN_WEEKLY_LIMIT,
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
