import { beginPasswordReset } from "@aquarela/application";

import { getAuthStore } from "../../../../../../lib/auth";
import { getAuthDeps } from "../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { limiters } from "../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../../lib/request";
import { requestContext } from "../../../../../../lib/request-context";

export const runtime = "nodejs";

/**
 * Starts a self-service reset. `beginPasswordReset` is neutral by construction
 * (always `{ ok: true }`, one hash on every path), so this always returns 200
 * and reveals nothing about the identifier. The plaintext token goes only to the
 * delivery port, never into the response.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.passwordResetBegin, async () => {
    const body = await readJsonObject(request);
    const identifier = readString(body, "identifier", 320);
    if (identifier === undefined) {
      return jsonError(400);
    }

    await beginPasswordReset(getAuthStore(), getAuthDeps(), {
      organizationId: resolveOrganization(),
      identifier,
      request: requestContext(request),
    });
    return jsonOk();
  });
}
