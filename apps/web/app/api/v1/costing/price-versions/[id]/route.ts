import {
  createPostgresCostingReadStore,
  createPostgresPriceScenarioStore,
  getPriceVersion,
} from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";
import { loadCostingRefs, toPriceVersionRow } from "../../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One effective price version (PRICE-002/003): the approved price for its exact
 * `(product variant, location, channel)` scope and its half-open effective
 * window. Response `{ ok: true, version }`, the same row shape as the list.
 * Signed out → 401; unknown or foreign id → 404.
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
    const db = getDb().db;
    const readStore = createPostgresCostingReadStore(db);
    const scenarioStore = createPostgresPriceScenarioStore(db);
    const version = await getPriceVersion(scenarioStore, {
      organizationId,
      priceVersionId: id,
    });
    if (version === undefined) {
      return jsonError(404);
    }

    const refs = await loadCostingRefs(readStore, {
      productVariantIds: [version.productVariantId],
      locationIds: version.locationId === null ? [] : [version.locationId],
      channelIds: version.channelId === null ? [] : [version.channelId],
    });
    return jsonOk({ version: toPriceVersionRow(organizationId, version, refs) });
  });
}
