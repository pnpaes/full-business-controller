import { cancelShift, createPostgresSchedulingStore, findShift } from "@aquarela/application";
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
 * Cancels one planned shift (`WF-002`, `DEC-037`). Limited to owner /
 * general_manager / location_manager / admin. The actor is the session user.
 *
 * A non-UUID id is a 400. For a location-scoped caller the shift is resolved
 * org-scoped first — unknown/cross-organization → 404 — then the scope is
 * checked (403 at another location). Any live state (`open`, `published`,
 * `assigned`) may be cancelled; `completed`/`cancelled` are terminal, so a
 * cancel of either is a command `DomainError` → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.cancelShift, async () => {
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
      updated = await cancelShift(store, {
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
