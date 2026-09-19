import { disableTotp } from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../lib/auth";
import { clearSessionCookie } from "../../../../../../lib/cookies";
import { getAuthDeps } from "../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { limiters } from "../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../../lib/request";
import { requestContext } from "../../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Disables TOTP after re-proving the password. Disabling a second factor is a
 * security downgrade, so `disableTotp` revokes every session for the user in the
 * same transaction as the disable: the next request must re-authenticate and, if
 * the role requires MFA (ADR-0003), re-enrol. Clearing the cookie below is a
 * client-side convenience only; it cannot join that transaction and is not relied
 * on for security, because the session rows are already revoked server-side.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.mfaDisable, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const password = readString(body, "password", 1024);
    if (password === undefined) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const result = await disableTotp(getAuthStore(), getAuthDeps(), {
      organizationId,
      userId: session.userId,
      password,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }

    // Server-side revocation already happened atomically inside `disableTotp`;
    // this only expires the browser copy of the cookie.
    return jsonOk({}, [clearSessionCookie()]);
  });
}
