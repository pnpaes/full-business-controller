import {
  createPostgresCostingReadStore,
  createPostgresPriceScenarioStore,
  listPriceVersions,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { loadCostingRefs, priceVersionRefRequest, toPriceVersionRows } from "../costing-views";
import { parsePriceVersionListQuery } from "./query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Effective price versions for the served organization (PRICE-002/003), newest
 * `effective_from` first. Query: `?limit=&offset=`. Response
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; malformed paging → 400.
 * Never returns another organization's versions.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parsePriceVersionListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const readStore = createPostgresCostingReadStore(db);
    const scenarioStore = createPostgresPriceScenarioStore(db);
    const { versions } = await listPriceVersions(scenarioStore, {
      organizationId,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    const refs = await loadCostingRefs(readStore, priceVersionRefRequest(versions));

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toPriceVersionRows(organizationId, versions, refs),
    });
  });
}
