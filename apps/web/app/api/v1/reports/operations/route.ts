import {
  buildOperationsReport,
  createPostgresReportingStore,
  type OperationsReport,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { SALES_REPORT_READ_ROLES, isReportingAuthorized, loadReportingAccess } from "../access";
import { checkSalesReportThrottle } from "../limiters";
import { parseOperationsReportQuery } from "../reporting-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The operational report (`RPT-004`, rows 13e/13f, `DEC-110`): stock
 * value/variance, production yield and waste value/reasons, over an on-demand,
 * org-scoped read model — no aggregate table, no audit fact (`ADR-0007`).
 *
 * Query: required `from`/`to` ISO instants (`from <= to`; the flow windows are
 * half-open `[from, to)`, stock value is point-in-time `<= asOf`), `grain`
 * (`day`|`week`|`month`) and an optional `locationId`. Response:
 * `{ ok: true, …OperationsReport }`. Signed out → 401; a role outside
 * `SALES_REPORT_READ_ROLES` (owner / general_manager / location_manager /
 * finance / admin / analyst — `kitchen`, `front_of_house` and `purchasing` are
 * denied) → 403; a malformed query → 400. Never returns another organization's
 * data (`DEC-061`).
 *
 * Location scope is resolved as in the sales summary route: an explicit
 * `locationId` outside the caller's scope → 403; a single-location caller with
 * no filter is pinned to their location; a multi-location caller with no filter
 * → 400 (never silently widened); an unscoped caller sees the whole
 * organization.
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

    const parsed = parseOperationsReportQuery(new URL(request.url).searchParams);
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
    const report: OperationsReport = await buildOperationsReport(store, {
      organizationId,
      from: parsed.query.from,
      to: parsed.query.to,
      grain: parsed.query.grain,
      ...(locationId === undefined ? {} : { locationIds: [locationId] }),
    });

    return jsonOk({ ...report });
  });
}
