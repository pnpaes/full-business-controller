import { logout } from "@aquarela/application";

import { getAuthStore, getSession } from "../../../../../lib/auth";
import { clearSessionCookie } from "../../../../../lib/cookies";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonOk } from "../../../../../lib/http";
import { limiters } from "../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../lib/organization";

export const runtime = "nodejs";

/**
 * Revokes the presented session server-side (not just the cookie) and always
 * clears the cookie. Idempotent: a missing or already-dead session still returns
 * success, so a client can log out without leaking whether the session existed.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.logout, async () => {
    const context = await getSession(request);
    if (context !== undefined) {
      await logout(getAuthStore(), {
        organizationId: resolveOrganization(),
        sessionId: context.session.id,
        actorId: context.session.userId,
      });
    }
    return jsonOk({}, [clearSessionCookie()]);
  });
}
