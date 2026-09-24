import { listRoles } from "@aquarela/application";

import { getAuthStore } from "../../../../../lib/auth";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { ADMIN_USERS_ROLES, isAdministrationAuthorized, loadAdministrationAccess } from "../access";
import { toRoleRow } from "../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The served organization's role catalogue (`07_SECURITY_AND_NFR.md` §7.1
 * "Users/configuration"), ordered by code — the set the management screen grants
 * from. Response: `{ ok: true, rows }`. Signed out → 401; a role outside
 * `ADMIN_USERS_ROLES` (owner / admin) → 403. Never returns another organization's
 * roles (`DEC-061`).
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_USERS_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const roles = await listRoles(getAuthStore(), { organizationId });

    return jsonOk({ rows: roles.map(toRoleRow) });
  });
}
