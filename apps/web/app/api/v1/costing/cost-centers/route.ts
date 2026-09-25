import { createPostgresCostingReadStore, listCostCenters } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { COST_CENTER_READ_ROLES, isCostingAuthorized, loadCostingAccess } from "../access";
import { toCostCenterRows } from "../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only cost centres (`DATA_DICTIONARY` §1), ordered by code, one bounded
 * page. Response `{ ok: true, rows }`. Signed out → 401; a role outside the
 * costing read set → 403. Never returns another organization's rows.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, COST_CENTER_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const centers = await listCostCenters(store, { organizationId });

    return jsonOk({ rows: toCostCenterRows(organizationId, centers) });
  });
}
