import { createPostgresCostingReadStore, getPriceScenarioDetail } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";
import { loadCostingRefs, toPriceScenarioRow } from "../../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One price scenario (PRICE-001–005): current/proposed price, tax/fees, margins,
 * volume effect, sensitivity and approval state. Response `{ ok: true, scenario }`
 * where `scenario` is the same row shape as the list endpoint. Signed out → 401;
 * unknown or foreign id → 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const { id } = await params;
    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const scenario = await getPriceScenarioDetail(store, {
      organizationId,
      priceScenarioId: id,
    });
    if (scenario === undefined) {
      return jsonError(404);
    }

    const refs = await loadCostingRefs(store, {
      productVariantIds: [scenario.productVariantId],
      locationIds: scenario.locationId === null ? [] : [scenario.locationId],
      channelIds: scenario.channelId === null ? [] : [scenario.channelId],
    });
    return jsonOk({ scenario: toPriceScenarioRow(organizationId, scenario, refs) });
  });
}
