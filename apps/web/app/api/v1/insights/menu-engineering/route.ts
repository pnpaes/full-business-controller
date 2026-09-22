import {
  buildMenuEngineeringReport,
  createPostgresReportingStore,
  type MenuEngineeringReport,
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
import { parseMenuEngineeringQuery } from "../../reports/reporting-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The menu-engineering report (`RPT-005`, `DEC-109`): each product classified
 * `high`/`low` on popularity (period units against the median of the
 * per-product units) and on contribution before labour/fees (against the median
 * within its own category), with the computed threshold values, their source
 * period, waste annotations and the unmapped bucket. An on-demand read — no
 * aggregate table, no audit fact (`ADR-0007`).
 *
 * Query: required inclusive `from`/`to` ISO instants (`from <= to`), `grain`
 * (`day`|`week`|`month`) and optional `locationId`/`channelId` filters.
 * Response: `{ ok: true, …MenuEngineeringReport }`. Signed out → 401; a role
 * outside `SALES_REPORT_READ_ROLES` (owner / general_manager / location_manager
 * / finance / admin / analyst — `kitchen`, `front_of_house` and `purchasing`
 * are denied) → 403; a malformed query → 400. Never returns another
 * organization's data (`DEC-061`).
 *
 * Location scope is resolved exactly as in `GET /api/v1/reports/sales`: an
 * explicit `locationId` outside the caller's scope → 403; a single-location
 * caller with no filter is pinned to their location; a multi-location caller
 * with no filter → 400 (the route refuses to guess rather than silently
 * widening); an unscoped caller sees the whole organization.
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

    const parsed = parseMenuEngineeringQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const scope = access.locationIds;
    let locationId = parsed.query.locationId;
    if (scope.length > 0) {
      if (locationId !== undefined && !scope.includes(locationId)) {
        return jsonError(403);
      }
      if (locationId === undefined) {
        if (scope.length === 1) {
          locationId = scope[0];
        } else {
          return jsonError(400, "locationId is required for a multi-location caller");
        }
      }
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const report: MenuEngineeringReport = await buildMenuEngineeringReport(store, {
      organizationId,
      from: parsed.query.from,
      to: parsed.query.to,
      grain: parsed.query.grain,
      ...(locationId === undefined ? {} : { locationIds: [locationId] }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
    });

    return jsonOk({ ...report });
  });
}
