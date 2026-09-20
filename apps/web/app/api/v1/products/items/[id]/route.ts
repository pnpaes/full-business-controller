import { createPostgresMasterDataStore, getItem, type ItemDetail } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { isUuid, toItemDetailResponse } from "../../product-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only item detail for the served organization (08_UI_UX.md §8.3): identity,
 * base unit, current cost, inventory policy and lot tracking, plus its supplier
 * packs and item-scoped effective conversions.
 *
 * Response `{ ok: true, item, supplierItems, conversions }`. Signed out → 401;
 * a malformed id → 400; an unknown or cross-organization id → 404.
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
    const store = createPostgresMasterDataStore(getDb().db);

    let detail: ItemDetail;
    try {
      detail = await getItem(store, { organizationId, itemId: id });
    } catch (error) {
      // `getItem` treats an unknown or cross-organization id as a domain failure.
      if (error instanceof DomainError) {
        return jsonError(404, error.message);
      }
      throw error;
    }

    const response = toItemDetailResponse(detail);
    return jsonOk({
      item: response.item,
      supplierItems: response.supplierItems,
      conversions: response.conversions,
    });
  });
}
