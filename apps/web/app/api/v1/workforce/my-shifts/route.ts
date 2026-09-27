import {
  createPostgresSchedulingStore,
  findSelfEmployee,
  listMyShifts,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { toMyShiftRows } from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in employee's own shifts (`WF-003`, `DEC-146`). The `app_user` is
 * resolved to their sole linked employee row and the read is scoped to that
 * employee, so the caller can never see another employee's shifts. Signed out →
 * 401; an account with no (or an ambiguous) employee link → 403.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    const employee = await findSelfEmployee(store, {
      organizationId,
      actorUserId: session.userId,
    });
    if (employee === undefined) {
      return jsonError(403);
    }

    const rows = await listMyShifts(store, {
      organizationId,
      actorUserId: session.userId,
    });

    return jsonOk({ rows: toMyShiftRows(rows) });
  });
}
