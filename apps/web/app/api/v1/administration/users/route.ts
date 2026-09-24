import { listUsers } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getAuthStore } from "../../../../../lib/auth";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { ADMIN_USERS_ROLES, isAdministrationAuthorized, loadAdministrationAccess } from "../access";
import { parseUsersQuery, toUserRow } from "../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The served organization's users with their roles and location scopes
 * (`07_SECURITY_AND_NFR.md` §7.1 "Users/configuration"), ordered by display name.
 *
 * Query: `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed
 * out → 401; a role outside `ADMIN_USERS_ROLES` (owner / admin) → 403; a
 * malformed page → 400. Never returns another organization's users (`DEC-061`)
 * and never returns `password_hash`, TOTP secrets or recovery codes.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_USERS_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseUsersQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = getAuthStore();

    let rows;
    try {
      rows = await listUsers(store, {
        organizationId,
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      // `listUsers` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: rows.map(toUserRow),
    });
  });
}
