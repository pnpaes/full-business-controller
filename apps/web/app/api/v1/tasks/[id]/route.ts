import { createPostgresTaskStore, findTask } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isTaskAuthorized, loadTaskAccess, TASK_READ_ROLES } from "../access";
import { isUuid, toTaskRow } from "../task-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One task by id (`DEC-122`). Response `{ ok: true, task }`.
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`).
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
    const access = await loadTaskAccess(session.userId);
    if (!isTaskAuthorized(access, TASK_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaskStore(getDb().db);
    const task = await findTask(store, { organizationId, taskId: id });
    if (task === undefined) {
      return jsonError(404);
    }

    const row = toTaskRow(organizationId, task);
    if (row === undefined) {
      return jsonError(404);
    }

    return jsonOk({ task: row });
  });
}
