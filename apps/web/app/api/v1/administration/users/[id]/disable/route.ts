import { disableUser } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { readJsonObject } from "../../../../../../../lib/request";

import { administrationLimiters } from "../../../limiters";
import { parseOptionalReason } from "../../../admin-rows";
import { withUserMutation } from "../../../user-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Off-boards one user (`07_SECURITY_AND_NFR.md` §7.1 "Users/configuration").
 * Body: `{ reason? }`. Sets `disabled` and revokes every session in one
 * transaction (ADR-0003); the operator confirms that consequence in the UI.
 *
 * Gated on the live `ADMIN_USERS_ROLES` (owner / admin). A non-UUID id → 400; a
 * non-string or over-long `reason` → 400; an unknown or cross-organization user →
 * 404.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withUserMutation(
    request,
    administrationLimiters.disableUser,
    id,
    async ({ session, store, organizationId, userId }) => {
      const parsed = parseOptionalReason(await readJsonObject(request));
      if (!parsed.ok) {
        return jsonError(400);
      }

      try {
        await disableUser(store, {
          organizationId,
          userId,
          actorId: session.userId,
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(400, error.message);
        }
        throw error;
      }

      return jsonOk({ userId, status: "disabled" });
    },
  );
}
