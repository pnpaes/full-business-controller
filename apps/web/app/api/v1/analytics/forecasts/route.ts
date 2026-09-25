import {
  computeForecastTracking,
  createPostgresForecastStore,
  recordForecastSnapshot,
  type ForecastTrackingReport,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../reports/access";
import {
  parseForecastSnapshotBody,
  parseForecastTrackingQuery,
  resolveLocationScope,
} from "../analytics-rows";
import { isForecastWriteAuthorized } from "../access";
import { analyticsLimiters, checkForecastTrackingThrottle } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The forecast-vs-actual **tracking** view (`DEC-011`, `DEC-138`). Distinct from
 * `GET /api/v1/analytics/forecast` (singular, the live model): this plural
 * surface tracks a **recorded snapshot** against the posted actuals of each
 * completed projected period and reports the out-of-sample MAPE.
 *
 * Honesty is the contract: `insufficient_history` (below the backend's minimum
 * completed periods) and `no_snapshot` are first-class results, and the accuracy
 * is `null` rather than a number from too few points. Only `day_location` is
 * implemented; the category/product grains are refused by the backend
 * (`DEC-011` ceiling), so the parser refuses them here too.
 *
 * Query: required `metric`, optional `grain` (default `day_location`), optional
 * `locationId`/`channelId`. Response `{ ok: true, …ForecastTrackingReport }`.
 * Signed out → 401; a role outside `SALES_REPORT_READ_ROLES` → 403; a malformed
 * query → 400. Location scope is resolved as in `GET /api/v1/reports/sales`.
 * Read throttle first (`DEC-135` store), fail-open.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const throttled = await checkForecastTrackingThrottle(request);
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

    const parsed = parseForecastTrackingQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }
    const resolved = resolveLocationScope(access.locationIds, parsed.query.locationId);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.message);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresForecastStore(getDb().db);
    const report: ForecastTrackingReport = await computeForecastTracking(store, {
      organizationId,
      metric: parsed.query.metric,
      grain: parsed.query.grain,
      ...(resolved.locationId === undefined ? {} : { locationId: resolved.locationId }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
    });

    return jsonOk({ ...report });
  });
}

/**
 * Records the current `computeForecast` output as a `forecast_snapshot`, so a
 * later read can compare it against posted actuals (`DEC-138`). The organization
 * and actor come from the session/env, never the body. The backend refuses an
 * `insufficient_history` forecast (there would be nothing to track) and returns
 * a `DomainError` that maps to 400.
 *
 * Guard order: same-origin + throttle (`withMutationGuards`), then session →
 * write role (`FORECAST_WRITE_ROLES`, owner / general_manager / admin) → body
 * parse. Body: required `metric`, optional `grain` (default `day_location`),
 * `locationId`/`channelId`, `historyPeriods`/`horizonPeriods`.
 * Response `{ ok: true, forecastSnapshotId }`.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, analyticsLimiters.recordForecastSnapshot, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadReportingAccess(session.userId);
    if (!isForecastWriteAuthorized(access)) {
      return jsonError(403);
    }

    const parsed = parseForecastSnapshotBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresForecastStore(getDb().db);
    const result = await recordForecastSnapshot(store, {
      organizationId,
      actorId: session.userId,
      ...parsed.fields,
    });

    return jsonOk({ forecastSnapshotId: result.forecastSnapshotId });
  });
}
