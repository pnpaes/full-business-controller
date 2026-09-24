import {
  computeBenchmarks,
  createPostgresReportingStore,
  type BenchmarkReport,
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
import { parseBenchmarksQuery, resolveLocationScope } from "../analytics-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The internal benchmark (`W6`): each entity's value against the organization
 * aggregate and the peer median of the same dimension, with the ratio and a
 * rank. **Internal only** — there is no external market data, and the response
 * says so (`basis: "internal"`).
 *
 * Query: required `dimension` (location|product|channel), `metric`
 * (revenue|contribution|units|transactions|average_order_value) and the
 * inclusive `from`/`to` period; optional `locationId`. Response:
 * `{ ok: true, …BenchmarkReport }`. Signed out → 401; a role outside
 * `SALES_REPORT_READ_ROLES` → 403; a malformed query or an unsupported
 * metric/dimension → 400. Location scope is resolved as in
 * `GET /api/v1/reports/sales`.
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

    const parsed = parseBenchmarksQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }
    const resolved = resolveLocationScope(access.locationIds, parsed.query.locationId);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.message);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const report: BenchmarkReport = await computeBenchmarks(store, {
      organizationId,
      dimension: parsed.query.dimension,
      metric: parsed.query.metric,
      period: { from: parsed.query.from, to: parsed.query.to },
      ...(resolved.locationId === undefined ? {} : { locationIds: [resolved.locationId] }),
    });

    return jsonOk({ ...report });
  });
}
