import { assignRecipeToVariant, createPostgresProductStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { productLimiters } from "../../../limiters";
import { isUuid } from "../../../product-rows";
import { parseRecipeAssignmentBody } from "../../../sellable-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assigns an approved recipe version to a variant at a location (`DEC-128`).
 * `assignRecipeToVariant` rejects a non-approved version, a cross-organization
 * location and an overlapping window, and the `pra_no_overlap` exclusion
 * constraint is translated to the same domain failure. Signed out → 401; a
 * malformed id or body → 400; a command rejection → 400 with its message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productLimiters.assignRecipe, async () => {
    const { session } = await requireSession(request);

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseRecipeAssignmentBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    try {
      const assigned = await assignRecipeToVariant(store, {
        organizationId,
        actorId: session.userId,
        productVariantId: id,
        ...parsed.input,
      });
      return jsonOk({ assignmentId: assigned.assignmentId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
