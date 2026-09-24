import { createPostgresProductStore, setAddonApplicability } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { productLimiters } from "../../../limiters";
import { isUuid } from "../../../product-rows";
import { parseAddonApplicabilityBody } from "../../../sellable-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Declares that the product in the path may be sold as an add-on to the base
 * product in the body (`DEC-128`). `setAddonApplicability` rejects a self-add-on
 * and a cross-organization product and is idempotent on the pair. Signed out →
 * 401; a malformed id or body → 400; a command rejection → 400 with its message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productLimiters.setAddonApplicability, async () => {
    const { session } = await requireSession(request);

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseAddonApplicabilityBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    try {
      const result = await setAddonApplicability(store, {
        organizationId,
        actorId: session.userId,
        addonProductId: id,
        ...parsed.input,
      });
      return jsonOk({
        addonApplicabilityId: result.addonApplicabilityId,
        created: result.created,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
