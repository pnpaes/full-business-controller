import {
  createPostgresMasterDataStore,
  listItems,
  registerItem,
  type ListItemsResult,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { parseRegisterItemBody } from "../item-body";
import { productLimiters } from "../limiters";
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

/**
 * Registers one item. The base unit arrives as its organization-unique code and
 * is resolved here (no unit-picker read model exists yet); `registerItem`
 * enforces emptiness, code/SKU uniqueness and idempotent re-runs, and the route
 * maps a command rejection to 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, productLimiters.registerItem, async () => {
    await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseRegisterItemBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);
    const baseUnit = await store.findUnitByCode(organizationId, parsed.input.baseUnitCode);
    if (baseUnit === undefined) {
      return jsonError(400, `base unit "${parsed.input.baseUnitCode}" not found`);
    }

    let created: { itemId: string; created: boolean };
    try {
      created = await registerItem(store, {
        organizationId,
        code: parsed.input.code,
        sku: parsed.input.sku,
        name: parsed.input.name,
        itemType: parsed.input.itemType,
        ...(parsed.input.purpose === undefined ? {} : { purpose: parsed.input.purpose }),
        baseUnitId: baseUnit.id,
        ...(parsed.input.inventoryPolicy === undefined
          ? {}
          : { inventoryPolicy: parsed.input.inventoryPolicy }),
        ...(parsed.input.lotTracked === undefined ? {} : { lotTracked: parsed.input.lotTracked }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ itemId: created.itemId, created: created.created });
  });
}
