import { createPostgresSchedulingStore, findShift, publishShift } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";

import { isWorkforceAuthorized, loadWorkforceAccess, SHIFT_WRITE_ROLES } from "../../../access";
import { shiftLimiters } from "../../../limiters";
import { isUuid, toShiftRow } from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publishes one planned shift (`WF-002`, `DEC-037`) so it becomes visible for
 * assignment. Limited to owner / general_manager / location_manager / admin
 * (`kitchen`/`front_of_house` may read but not plan, and `finance` may read but
 * not write). The actor is the session user.
 *
 * A non-UUID id is a 400. For a location-scoped caller the shift is resolved
 * org-scoped first — unknown/cross-organization → 404 — then the scope is
 * checked (403 at another location). Only an `open` shift may be published; a
 * repeat publish or any other state is a command `DomainError` → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.publishShift, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
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
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES, shift.locationId)) {
      return jsonError(403);
    }

    let updated;
    try {
      updated = await publishShift(store, {
        organizationId,
        shiftId: id,
        actorId: session.userId,
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
