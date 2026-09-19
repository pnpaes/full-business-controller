import { authenticate } from "@aquarela/application";

import { getAuthStore } from "../../../../../lib/auth";
import { serializeSessionCookie } from "../../../../../lib/cookies";
import { getAuthDeps } from "../../../../../lib/deps";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../lib/http";
import { limiters } from "../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../lib/request";
import { requestContext } from "../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Password step. A fresh session token is minted by `authenticate` and set as an
 * HttpOnly cookie; when MFA is enrolled no session is issued and the caller must
 * complete the second factor at `/api/v1/auth/mfa`.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.login, async () => {
    const body = await readJsonObject(request);
    const identifier = readString(body, "identifier", 320);
    const password = readString(body, "password", 1024);
    if (identifier === undefined || password === undefined) {
      return jsonError(400);
    }

    const result = await authenticate(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      identifier,
      password,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }
    if (result.mfaRequired) {
      return jsonOk({ mfaRequired: true });
    }
    if (result.session === undefined) {
      return jsonError(500);
    }
    return jsonOk({ mfaRequired: false, expiresAt: result.session.expiresAt.toISOString() }, [
      serializeSessionCookie(result.session.token, result.session.expiresAt),
    ]);
  });
}
