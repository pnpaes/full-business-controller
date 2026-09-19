import { beginTotpEnrolment } from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../../lib/auth";
import { getAuthDeps } from "../../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { limiters } from "../../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { requestContext } from "../../../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Starts TOTP enrolment for the signed-in user. The response carries the base32
 * secret and the `otpauth://` URI exactly once (the 1d command's contract) to an
 * authenticated owner of that identity; it is never persisted, logged or cached.
 * A re-begin replaces any unconfirmed secret, so an abandoned attempt is
 * recoverable.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.mfaEnrolmentBegin, async () => {
    const { session } = await requireSession(request);
    const result = await beginTotpEnrolment(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      userId: session.userId,
      request: requestContext(request),
    });
    if (!result.ok) {
      return jsonError(401);
    }

    const response = jsonOk({
      secret: result.secret,
      uri: result.uri,
      issuer: result.issuer,
      account: result.account,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
