import { createPostgresCostingReadStore, getCostCardDetail } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";
import { costCardRefRequest, loadCostingRefs, toCostCardDetailView } from "../../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One cost card with its frozen snapshot, stored components and same-scope
 * history (COST-005/008; 08_UI_UX.md §8.3). Response `{ ok: true, card, totals,
 * components, history }`. Signed out → 401; unknown or foreign id → 404.
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
    const detail = await getCostCardDetail(store, { organizationId, costCardId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const refs = await loadCostingRefs(store, costCardRefRequest(detail));
    return jsonOk({ ...toCostCardDetailView(organizationId, detail, refs) });
  });
}
