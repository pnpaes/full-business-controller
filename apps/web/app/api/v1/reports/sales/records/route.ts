import { createPostgresReportingStore, listSalesReportRecords } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { SALES_REPORT_READ_ROLES, isReportingAuthorized, loadReportingAccess } from "../../access";
import { checkSalesReportThrottle } from "../../limiters";
import { parseSalesReportRecordsQuery } from "../../reporting-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The RPT-002 drill-down: the sales lines behind a summary, each with its
 * resolved net sales and the ledger ingredient cost it contributed. Same
 * filters as `GET /api/v1/reports/sales` plus bounded `limit` (1–500, default
 * 100) / `offset`; `truncated` is conservative. A read — no audit fact.
 * `option_kind='included'` lines are excluded (`SALE-011`, a revenue/margin
 * view); the response `notes` says so. `groupBy` is not a parameter here.
 *
 * Signed out → 401; a role outside `SALES_REPORT_READ_ROLES` → 403; a malformed
 * query → 400. Location scope is resolved exactly as in the summary route and
 * **accepts the caller's full scope** so a multi-location caller's drill-down
 * works:
 * - an explicit `locationId` or every id in `locationIds` outside the caller's
 *   scope → 403;
 * - an explicit `locationId` (a group's own location) is used as-is;
 * - an explicit `locationIds` list is used as the scope;
 * - a caller with a location scope and no filter is pinned to their **full
 *   scope** (the summary-widening behaviour the page relies on, never a 400);
 * - an unscoped caller sees the whole organization.
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

    const parsed = parseSalesReportRecordsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const scope = access.locationIds;
    if (scope.length > 0) {
      const requested = parsed.query.locationIds;
      if (requested !== undefined && requested.some((id) => !scope.includes(id))) {
        return jsonError(403);
      }
      const single = parsed.query.locationId;
      if (single !== undefined && !scope.includes(single)) {
        return jsonError(403);
      }
    }

    // Precedence: an explicit single `locationId` (a group's location) narrows
    // the list; else the explicit `locationIds`; else the caller's full scope.
    const locationIds =
      parsed.query.locationId !== undefined
        ? [parsed.query.locationId]
        : (parsed.query.locationIds ?? (scope.length > 0 ? scope : undefined));

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const records = await listSalesReportRecords(store, {
      organizationId,
      actorId: session.userId,
      from: parsed.query.from,
      to: parsed.query.to,
      grain: parsed.query.grain,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      ...(locationIds === undefined ? {} : { locationIds }),
      ...(parsed.query.channelId === undefined ? {} : { channelId: parsed.query.channelId }),
      ...(parsed.query.category === undefined ? {} : { category: parsed.query.category }),
      ...(parsed.query.productVariantId === undefined
        ? {}
        : { productVariantId: parsed.query.productVariantId }),
    });

    return jsonOk({ ...records });
  });
}
