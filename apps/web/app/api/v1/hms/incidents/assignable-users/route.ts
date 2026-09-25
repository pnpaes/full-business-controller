import { createPostgresTaskStore, listAssignableUsers } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { HMS_INCIDENT_READ_ROLES, isHmsAuthorized, loadHmsAccess } from "../../access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The candidate owners for the incident owner picker: the served organization's
 * **active** `app_user` rows reduced to `(id, displayName, username)`.
 *
 * The incident domain has no user read of its own. This reuses the
 * candidate-assignee read the task picker uses (`listAssignableUsers`,
 * `DEC-122`) rather than the auth directory (`listUsers`): the read is over
 * `app_user`, not the task table, it is organization-scoped (`DEC-061`), it
 * excludes off-boarded accounts and it returns only what a picker needs — no
 * email, roles or credential material. `listUsers` is the management page and
 * carries every status plus role/scope/PII fields, which a picker must not show
 * or offer.
 *
 * Gated on the incident read set (`HMS_INCIDENT_READ_ROLES`), exactly the union
 * of the roles that may raise an incident and the roles that may edit one
 * (`07_SECURITY_AND_NFR.md` §7.1 "HMS incidents/corrective actions"), so the
 * picker is no wider than the screens that render it. Signed out → 401; a role
 * outside the set → 403. The read never spans organizations (`DEC-061`).
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const users = await listAssignableUsers(createPostgresTaskStore(getDb().db), {
      organizationId,
    });

    return jsonOk({
      users: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        username: user.username,
      })),
    });
  });
}
