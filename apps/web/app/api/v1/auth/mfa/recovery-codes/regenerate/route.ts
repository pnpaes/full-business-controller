import { regenerateRecoveryCodes } from "@aquarela/application";

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
 * Replaces the caller's recovery codes. Requires a fresh TOTP code, so an old
 * one cannot authorise the reset; the new codes are returned exactly once. The
 * previous set is invalidated by replacement.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.mfaRecoveryRegenerate, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const code = readString(body, "code", 64);
    if (code === undefined) {
      return jsonError(400);
    }

    const result = await regenerateRecoveryCodes(getAuthStore(), getAuthDeps(), {
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
