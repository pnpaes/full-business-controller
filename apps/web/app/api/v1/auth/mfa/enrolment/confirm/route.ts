import { confirmTotpEnrolment } from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../../lib/auth";
import { getAuthDeps } from "../../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { limiters } from "../../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../../../lib/request";
import { requestContext } from "../../../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Confirms enrolment with a fresh TOTP code and returns the one-time recovery
 * codes exactly once, to the authenticated owner. A wrong, replayed, expired or
 * unsealed code gets the single generic error and leaves enrolment unconfirmed.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.mfaEnrolmentConfirm, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const code = readString(body, "code", 64);
    if (code === undefined) {
      return jsonError(400);
    }

    const result = await confirmTotpEnrolment(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      userId: session.userId,
      token: code,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }

    const response = jsonOk({ recoveryCodes: result.recoveryCodes });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
