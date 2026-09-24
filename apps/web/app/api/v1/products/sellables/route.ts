import { createPostgresProductStore, listProducts, registerProduct } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { productLimiters } from "../limiters";
import { parseRegisterProductBody, toProductWithVariantsRow } from "../sellable-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only product list for the served organization (`DEC-128`), each product
 * with its variants. Response `{ ok: true, products: [...] }`. Signed out → 401;
 * never returns another organization's products.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);
    const products = await listProducts(store, { organizationId });

    return jsonOk({ products: products.map(toProductWithVariantsRow) });
  });
}

/**
 * Registers a product. `registerProduct` is idempotent on `(organization, code)`
 * and the route maps a command rejection to 400 with its message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, productLimiters.registerProduct, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseRegisterProductBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductStore(getDb().db);

    try {
      const created = await registerProduct(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.input,
      });
      return jsonOk({ productId: created.productId, created: created.created });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
