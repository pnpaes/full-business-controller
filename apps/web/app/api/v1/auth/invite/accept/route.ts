import { acceptInvite } from "@aquarela/application";

import { getAuthStore } from "../../../../../../lib/auth";
import { serializeSessionCookie } from "../../../../../../lib/cookies";
import { getAuthDeps } from "../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { limiters } from "../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../../lib/request";
import { requestContext } from "../../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Redeems an employee invite (`DEC-146`). Body: `{ token, password }`. The token
 * travels in the JSON body (never a URL or query string) and is never echoed; an
 * unknown, expired, revoked or already-used token gets the single generic 401,
 * so the response cannot enumerate users or invites. On success the account
 * becomes `active` and a fresh session cookie is set, exactly like login.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.inviteAccept, async () => {
    const body = await readJsonObject(request);
    const token = readString(body, "token", 512);
    const password = readString(body, "password", 1024);
    if (token === undefined || password === undefined) {
      return jsonError(400);
    }

    const result = await acceptInvite(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      token,
      newPassword: password,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }
    return jsonOk({ expiresAt: result.session.expiresAt.toISOString() }, [
      serializeSessionCookie(result.session.token, result.session.expiresAt),
    ]);
  });
}
