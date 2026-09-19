import { disableTotp, logoutAll } from "@aquarela/application";

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
 * security downgrade, so every session for the user is revoked server-side and
 * the cookie is cleared: the next request must re-authenticate and, if the role
 * requires MFA (ADR-0003), re-enrol. The 1d `disableTotp` command deliberately
 * does not revoke sessions; this handler adds that policy explicitly.
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

    await logoutAll(getAuthStore(), {
      organizationId,
      userId: session.userId,
      actorId: session.userId,
      reason: "mfa_disabled",
    });
    return jsonOk({}, [clearSessionCookie()]);
  });
}
