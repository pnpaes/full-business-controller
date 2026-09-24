import {
  createPostgresProductStore,
  findProductVariant,
  updateProductVariant,
  type ProductVariantDetail,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import { productLimiters } from "../../limiters";
import { isUuid } from "../../product-rows";
import { parseUpdateVariantBody, toVariantDetailRow } from "../../sellable-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only variant detail for the served organization (`DEC-128`): identity,
 * its product, its recipe assignments (with location and version) and the
 * add-on applicability rows naming its product.
 *
 * Response `{ ok: true, variant, product, recipeAssignments, addonApplicability }`.
 * Signed out → 401; a malformed id → 400; unknown or cross-organization → 404.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    let detail: ProductVariantDetail;
    try {
      detail = await findProductVariant(store, { organizationId, productVariantId: id });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(404, error.message);
      }
      throw error;
    }

    const row = toVariantDetailRow(detail);
    return jsonOk({
      variant: row.variant,
      product: row.product,
      recipeAssignments: row.recipeAssignments,
      addonApplicability: row.addonApplicability,
    });
  });
}

/**
 * Updates the mutable fields of one variant: `name`, `size` and the nullable
 * `finishedGoodItemId`. `code`/`sku`/`productId` are immutable. Signed out → 401;
 * a malformed id or body → 400; a command rejection → 400 with its message.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productLimiters.updateVariant, async () => {
    const { session } = await requireSession(request);

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseUpdateVariantBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    try {
      const updated = await updateProductVariant(store, {
        organizationId,
        actorId: session.userId,
        productVariantId: id,
        ...parsed.input,
      });
      return jsonOk({ productVariantId: updated.productVariantId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
