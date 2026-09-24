import {
  computeForecast,
  createPostgresReportingStore,
  type ForecastResult,
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
import { parseForecastQuery, resolveLocationScope } from "../analytics-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The advisory forecast (`W6`): a least-squares linear trend fitted over the
 * history, projected over the horizon, with its ±1 residual-σ band and its
 * backtested accuracy. **A model, not a fact** — the response states its method,
 * inputs and error, and returns an explicit `insufficient_history` rather than a
 * projection when the history is too short.
 *
 * Query: required `metric` (see trends) and `grain`, optional `historyPeriods`
 * (default 12), `horizonPeriods` (default 3), `locationId`/`channelId`.
 * Response: `{ ok: true, …ForecastResult }`. Signed out → 401; a role outside
 * `SALES_REPORT_READ_ROLES` → 403; a malformed query → 400. Location scope is
 * resolved as in `GET /api/v1/reports/sales`.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const throttled = checkSalesReportThrottle(request);
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

    const parsed = parseForecastQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }
    const resolved = resolveLocationScope(access.locationIds, parsed.query.locationId);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.message);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const forecast: ForecastResult = await computeForecast(store, {
      organizationId,
      metric: parsed.query.metric,
      grain: parsed.query.grain,
      ...(resolved.locationId === undefined ? {} : { locationIds: [resolved.locationId] }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
      ...(parsed.query.historyPeriods === undefined
        ? {}
        : { historyPeriods: parsed.query.historyPeriods }),
      ...(parsed.query.horizonPeriods === undefined
        ? {}
        : { horizonPeriods: parsed.query.horizonPeriods }),
    });

    return jsonOk({ ...forecast });
  });
}
