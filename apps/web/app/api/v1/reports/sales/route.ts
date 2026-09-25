import {
  buildSalesReport,
  createPostgresReportingStore,
  type SalesReport,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { SALES_REPORT_READ_ROLES, isReportingAuthorized, loadReportingAccess } from "../access";
import { checkSalesReportThrottle } from "../limiters";
import { parseSalesReportQuery } from "../reporting-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sales & margin report (`RPT-001`, `ADR-0007`): the window's sales lines
 * grouped by one dimension, with net sales, ledger ingredient cost and
 * **contribution before labour/fees**, plus totals and caveats. An on-demand
 * read — no aggregate table, no audit fact (`ADR-0007`).
 *
 * Query: required inclusive `from`/`to` ISO instants (`from <= to`), `grain`
 * (`day`|`week`|`month`), `groupBy`
 * (`location`|`channel`|`category`|`product`|`period`) and optional
 * `locationId`/`channelId`/`category`/`productVariantId` filters. Response:
 * `{ ok: true, …SalesReport }`. Signed out → 401; a role outside
 * `SALES_REPORT_READ_ROLES` (owner / general_manager / location_manager /
 * finance / admin / analyst — `kitchen`, `front_of_house` and `purchasing` are
 * denied) → 403; a malformed query → 400. Never returns another organization's
 * data (`DEC-061`).
 *
 * Location scope is resolved here (the `worked-hours` precedent): an explicit
 * `locationId` outside the caller's scope → 403; a single-location caller with
 * no filter is pinned to their location; a multi-location caller with no filter
 * → 400 (the route refuses to guess rather than silently widening); an unscoped
 * caller sees the whole organization.
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

    const parsed = parseSalesReportQuery(new URL(request.url).searchParams);
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
    const report: SalesReport = await buildSalesReport(store, {
      organizationId,
      actorId: session.userId,
      from: parsed.query.from,
      to: parsed.query.to,
      grain: parsed.query.grain,
      groupBy: parsed.query.groupBy,
      ...(locationId === undefined ? {} : { locationIds: [locationId] }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
      ...(parsed.query.category === undefined ? {} : { category: parsed.query.category }),
      ...(parsed.query.productVariantId === undefined
        ? {}
        : { productVariantId: parsed.query.productVariantId }),
    });

    return jsonOk({ ...report });
  });
}
