import {
  createPostgresMasterDataStore,
  listItems,
  type ListItemsResult,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { parseItemsQuery, toItemRow } from "../product-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only item list for the served organization (08_UI_UX.md §8.3).
 *
 * Query: optional `?search=` (code/SKU/name contains), `?itemType=`, `?limit=`
 * (1–200, default 50) and `?offset=` (default 0). Response:
 * `{ ok: true, items, total, limit, offset }`. Signed out → 401; a malformed
 * filter or page → 400. Never returns another organization's items.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseItemsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);

    let page: ListItemsResult;
    try {
      page = await listItems(store, { organizationId, ...parsed.query });
    } catch (error) {
      // `listItems` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      items: page.items.map(toItemRow),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    });
  });
}
