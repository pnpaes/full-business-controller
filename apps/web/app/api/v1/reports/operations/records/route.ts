import { createPostgresReportingStore, listOperationsReportRecords } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { SALES_REPORT_READ_ROLES, isReportingAuthorized, loadReportingAccess } from "../../access";
import { checkSalesReportThrottle } from "../../limiters";
import { parseOperationsReportRecordsQuery } from "../../reporting-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The RPT-002 operational drill-down: the records behind one section
 * (`stock_value` | `stock_variance` | `production` | `waste`), each tagged with
 * its section. Same access and scope rules as `GET /api/v1/reports/operations`
 * plus a bounded `limit` (1–500, default 100) / `offset`; `truncated` is
 * conservative. The flow sections use the half-open `[from, to)` window
 * (`DEC-110` item 6); for `stock_value` the window is the point-in-time as-of
 * instant, echoed from the report as `asOf` (defaulting to now; the response
 * `notes` say so). A read — no audit fact (`ADR-0007`).
 *
 * Signed out → 401; a role outside `SALES_REPORT_READ_ROLES` → 403; a malformed
 * query → 400. Location scope is resolved exactly as in the sales records route
 * and **accepts the caller's full scope** so a multi-location caller's
 * drill-down works:
 * - an explicit `locationId` or every id in `locationIds` outside the caller's
 *   scope → 403;
 * - an explicit `locationId` narrows the list; else the explicit `locationIds`;
 *   else the caller's full scope;
 * - an unscoped caller sees the whole organization.
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

    const parsed = parseOperationsReportRecordsQuery(new URL(request.url).searchParams);
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

    const locationIds =
      parsed.query.locationId !== undefined
        ? [parsed.query.locationId]
        : (parsed.query.locationIds ?? (scope.length > 0 ? scope : undefined));

    const organizationId = resolveOrganization();
    const store = createPostgresReportingStore(getDb().db);
    const records = await listOperationsReportRecords(store, {
      organizationId,
      section: parsed.query.section,
      from: parsed.query.from,
      to: parsed.query.to,
      grain: parsed.query.grain,
      ...(parsed.query.asOf === undefined ? {} : { asOf: parsed.query.asOf }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      ...(locationIds === undefined ? {} : { locationIds }),
    });

    return jsonOk({ ...records });
  });
}
