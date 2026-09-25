import {
  computeSuggestions,
  createPostgresReportingStore,
  type SuggestionsReport,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../reports/access";
import { checkSalesReportThrottle } from "../../reports/limiters";
import { parseSuggestionsQuery, resolveLocationScope } from "../analytics-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The rule-based suggestions (`W6`): transparent, explainable advisories derived
 * from the computed facts, each carrying its rule id, evidence, severity and
 * suggested action. **Advisory only** (`DEC-039`): no AI, no opaque scoring, no
 * auto-apply — the response states its posture.
 *
 * Query: the inclusive `from`/`to` period, optional `grain` (default month),
 * `trendPeriods` (default 6) and `locationId`. Response:
 * `{ ok: true, …SuggestionsReport }`. Signed out → 401; a role outside
 * `SALES_REPORT_READ_ROLES` → 403; a malformed query → 400. Location scope is
 * resolved as in `GET /api/v1/reports/sales`.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const throttled = await checkSalesReportThrottle(request);
    if (throttled !== undefined) {
      return throttled;
    }

    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadReportingAccess(session.userId);
    if (!isReportingAuthorized(access, SALES_REPORT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseSuggestionsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }
    const resolved = resolveLocationScope(access.locationIds, parsed.query.locationId);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.message);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const report: SuggestionsReport = await computeSuggestions(store, {
      organizationId,
      period: { from: parsed.query.from, to: parsed.query.to },
      ...(parsed.query.grain === undefined ? {} : { grain: parsed.query.grain }),
      ...(parsed.query.trendPeriods === undefined
        ? {}
        : { trendPeriods: parsed.query.trendPeriods }),
      ...(resolved.locationId === undefined ? {} : { locationIds: [resolved.locationId] }),
    });

    return jsonOk({ ...report });
  });
}
