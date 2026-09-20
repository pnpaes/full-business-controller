import { createPostgresCostingReadStore, listPriceScenarios } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { loadCostingRefs, priceScenarioRefRequest, toPriceScenarioRows } from "../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only price scenarios for the served organization (PRICE-001–005), newest
 * first. Response `{ ok: true, rows }`. Signed out → 401.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const scenarios = await listPriceScenarios(store, { organizationId });
    const refs = await loadCostingRefs(store, priceScenarioRefRequest(scenarios));

    return jsonOk({ rows: toPriceScenarioRows(organizationId, scenarios, refs) });
  });
}
