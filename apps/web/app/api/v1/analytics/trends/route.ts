import {
  computeTrends,
  createPostgresReportingStore,
  type TrendSeries,
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
import { parseTrendsQuery, resolveLocationScope } from "../analytics-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The period-over-period trend series (`W6`): each period's metric value with
 * its comparison against the previous period, the absolute and relative change
 * and a direction, over the existing reporting reads. Read-only — no aggregate
 * table, no audit fact.
 *
 * Query: required `metric` (revenue|contribution|units|transactions|
 * average_order_value|production_yield|waste) and `grain` (`day`|`week`|
 * `month`), optional `locationId`/`channelId` and `periods` (1..60, default 6).
 * Response: `{ ok: true, …TrendSeries }`, which states its method and flat band.
 * Signed out → 401; a role outside `SALES_REPORT_READ_ROLES` → 403; a malformed
 * query → 400. Location scope is resolved as in `GET /api/v1/reports/sales`.
 * Never returns another organization's data (`DEC-061`).
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

    const parsed = parseTrendsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }
    const resolved = resolveLocationScope(access.locationIds, parsed.query.locationId);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.message);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const trend: TrendSeries = await computeTrends(store, {
      organizationId,
      metric: parsed.query.metric,
      grain: parsed.query.grain,
      ...(resolved.locationId === undefined ? {} : { locationIds: [resolved.locationId] }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
      ...(parsed.query.periods === undefined ? {} : { periods: parsed.query.periods }),
    });

    return jsonOk({ ...trend });
  });
}
