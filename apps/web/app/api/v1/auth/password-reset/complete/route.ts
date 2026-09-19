import { completePasswordReset } from "@aquarela/application";

import { getAuthStore } from "../../../../../../lib/auth";
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
 * Redeems a reset token. The token travels in the JSON body (never a URL or
 * query string), is never echoed, and an invalid, expired or used token gets the
 * single generic error. On success the application revokes every session, so the
 * cookie is cleared too.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.passwordResetComplete, async () => {
    const body = await readJsonObject(request);
    const token = readString(body, "token", 512);
    const newPassword = readString(body, "newPassword", 1024);
    if (token === undefined || newPassword === undefined) {
      return jsonError(400);
    }

    const result = await completePasswordReset(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      token,
      newPassword,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }
    return jsonOk({}, [clearSessionCookie()]);
  });
}
