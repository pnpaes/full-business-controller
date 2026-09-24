import { createPostgresProductStore, registerProductVariant } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { productLimiters } from "../../../limiters";
import { isUuid } from "../../../product-rows";
import { parseRegisterVariantBody } from "../../../sellable-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registers a variant of one product (`DEC-128`) — the sellable identity
 * (`DEC-030`). `registerProductVariant` validates the product's organization,
 * the per-organization SKU uniqueness and the optional finished-good item, and
 * is idempotent on `(product_id, code)`. Signed out → 401; a malformed id or
 * body → 400; a command rejection → 400 with its message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productLimiters.registerVariant, async () => {
    const { session } = await requireSession(request);

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseRegisterVariantBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    try {
      const created = await registerProductVariant(store, {
        organizationId,
        actorId: session.userId,
        productId: id,
        ...parsed.input,
      });
      return jsonOk({ productVariantId: created.productVariantId, created: created.created });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
