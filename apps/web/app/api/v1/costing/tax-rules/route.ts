import {
  MAX_TAX_RULE_LIMIT,
  createPostgresCostingReadStore,
  listTaxRules,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { TAX_RULE_READ_ROLES, isCostingAuthorized, loadCostingAccess } from "../access";
import { toTaxRuleRows } from "../costing-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only tax rules (`DATA_DICTIONARY` §1, PRICE-005), ordered by code, one
 * bounded page. Response `{ ok: true, rows }`. Signed out → 401; a role outside
 * the costing read set → 403. Never returns another organization's rows.
 *
 * The picker asks for the read's hard cap rather than the default page: a
 * truncated list would silently hide a valid rule a caller needs to reference.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, TAX_RULE_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const rules = await listTaxRules(store, { organizationId, limit: MAX_TAX_RULE_LIMIT });

    return jsonOk({ rows: toTaxRuleRows(organizationId, rules) });
  });
}
