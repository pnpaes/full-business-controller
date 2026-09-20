import { createPostgresCostingReadStore, listCostCards } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { toCostCardRows, loadCostingRefs } from "../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only cost cards for the served organization (COST-005/008), newest first.
 * Response `{ ok: true, rows }`. Signed out → 401. Never returns another
 * organization's rows.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const cards = await listCostCards(store, { organizationId });
    const refs = await loadCostingRefs(store, {
      productVariantIds: cards.map((card) => card.productVariantId),
      locationIds: cards.map((card) => card.locationId),
      channelIds: cards.flatMap((card) => (card.channelId === null ? [] : [card.channelId])),
    });

    return jsonOk({ rows: toCostCardRows(organizationId, cards, refs) });
  });
}
