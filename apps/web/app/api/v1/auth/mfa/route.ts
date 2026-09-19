import { authenticate, verifyMfa } from "@aquarela/application";
import type { AuthenticateResult } from "@aquarela/application";

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
 * Second factor (fresh TOTP code or single-use recovery code).
 *
 * The request re-presents the identifier and password, so `authenticate` proves
 * the first factor in this same request and `verifyMfa` receives the user id
 * server-side. The password step's user id is never returned to the client and
 * never accepted from it, which stops the endpoint collapsing into TOTP-only
 * access for anyone who learns a user id.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.mfa, async () => {
    const body = await readJsonObject(request);
    const identifier = readString(body, "identifier", 320);
    const password = readString(body, "password", 1024);
    const code = readString(body, "code", 64);
    if (identifier === undefined || password === undefined || code === undefined) {
      return jsonError(400);
    }

    const deps = getAuthDeps();
    const organizationId = resolveOrganization();
    const first: AuthenticateResult = await authenticate(getAuthStore(), deps, {
      organizationId,
      identifier,
      password,
      request: requestContext(request),
    });
    if (!first.ok) {
      return jsonError(401);
    }

    if (!first.mfaRequired) {
      // A password-only account: `authenticate` already issued the session.
      if (first.session === undefined) {
        return jsonError(500);
      }
      return jsonOk({ mfaRequired: false, expiresAt: first.session.expiresAt.toISOString() }, [
        serializeSessionCookie(first.session.token, first.session.expiresAt),
      ]);
    }

    const result = await verifyMfa(getAuthStore(), deps, {
      organizationId,
      userId: first.user.id,
      token: code,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }
    return jsonOk({ mfaRequired: false, expiresAt: result.session.expiresAt.toISOString() }, [
      serializeSessionCookie(result.session.token, result.session.expiresAt),
    ]);
  });
}
