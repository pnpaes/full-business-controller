import { assignRole, listRoles } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { jsonError, jsonOk } from "../../../../../../../../lib/http";
import { readJsonObject } from "../../../../../../../../lib/request";

import { administrationLimiters } from "../../../../limiters";
import { parseRoleBody } from "../../../../admin-rows";
import { withUserMutation } from "../../../../user-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grants one role to one user (`07_SECURITY_AND_NFR.md` §7.1
 * "Users/configuration"). Body: `{ roleId, locationId? }` — an absent/`null`
 * `locationId` is the organization-wide grant. Because a role change is a
 * privilege change, the command revokes every session for that user in the same
 * transaction (ADR-0003); the operator confirms that consequence in the UI.
 *
 * Gated on the live `ADMIN_USERS_ROLES` (owner / admin). A non-UUID id or body →
 * 400; a role outside the organization's catalogue → 400; an unknown or
 * cross-organization user → 404.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withUserMutation(
    request,
    administrationLimiters.grantRole,
    id,
    async ({ session, store, organizationId, userId }) => {
      const parsed = parseRoleBody(await readJsonObject(request));
      if (!parsed.ok) {
        return jsonError(400);
      }

      const roles = await listRoles(store, { organizationId });
      if (!roles.some((role) => role.id === parsed.roleId)) {
        return jsonError(400, "unknown role");
      }

      try {
        await assignRole(store, {
          organizationId,
          userId,
          roleId: parsed.roleId,
          locationId: parsed.locationId,
          actorId: session.userId,
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(400, error.message);
        }
        throw error;
      }

      return jsonOk({ userId });
    },
  );
}
