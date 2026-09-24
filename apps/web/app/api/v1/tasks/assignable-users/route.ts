import { createPostgresTaskStore, listAssignableUsers } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isTaskAuthorized, loadTaskAccess, TASK_READ_ROLES } from "../access";
import { toAssignableUserRows } from "../task-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The candidate assignees for the task picker (`DEC-122`): the served
 * organization's **active** `app_user` rows reduced to `(id, displayName,
 * username)`. This is the smallest honest read — there is no user-directory
 * service — and it is organization-scoped (`DEC-061`).
 *
 * Read-gated like the task list (every authenticated role reads); signed out →
 * 401, a role outside the read set → 403. It exposes no email or credential
 * field, only what a picker needs.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadTaskAccess(session.userId);
    if (!isTaskAuthorized(access, TASK_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaskStore(getDb().db);
    const users = await listAssignableUsers(store, { organizationId });

    return jsonOk({ users: toAssignableUserRows(users) });
  });
}
