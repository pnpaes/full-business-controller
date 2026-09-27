import { createPostgresSchedulingStore, listPendingSelfAssignments } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { isWorkforceAuthorized, loadWorkforceAccess, SHIFT_WRITE_ROLES } from "../../access";
import { parseShiftAssignmentListQuery, toPendingSelfAssignmentRows } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manager review queue (`WF-003`, `DEC-146`): the self-originated
 * `pending_approval` assignments awaiting a decision. Restricted to the shift
 * write roles (owner / general_manager / location_manager / admin); a
 * location-scoped caller sees only rows whose shift is at a location in scope
 * (fail-closed).
 *
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the write set → 403; malformed paging → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseShiftAssignmentListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    let rows;
    try {
      rows = await listPendingSelfAssignments(store, {
        organizationId,
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    const scoped =
      access.locationIds.length === 0
        ? rows
        : rows.filter((row) => access.locationIds.includes(row.locationId));

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toPendingSelfAssignmentRows(scoped),
    });
  });
}
