import { computeWorkedHours, createPostgresSchedulingStore } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isWorkforceAuthorized, loadWorkforceAccess, WORKED_HOURS_READ_ROLES } from "../access";
import { parseWorkedHoursQuery } from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The derived worked-hours report for a period (`WF-004`): one row per employee
 * with the hours they actually worked in the half-open `[from, to)` window, plus
 * the period total.
 *
 * Query: required `from`/`to` ISO instants with seconds (`from < to`, else 400)
 * and optional `locationId`/`employeeId` UUID filters. Response:
 * `{ ok: true, from, to, rows, totalHours }`. Signed out → 401; a role outside
 * `WORKED_HOURS_READ_ROLES` (owner / general_manager / location_manager /
 * finance / admin — `kitchen`, `front_of_house`, `purchasing` and `analyst` are
 * denied, `07_SECURITY_AND_NFR.md` §7.1) → 403; a malformed period or filter →
 * 400. Never returns another organization's data (`DEC-061`).
 *
 * Location scope is resolved here because the application query takes a single
 * `locationId` while the report rows carry no location field, so a multi-location
 * caller cannot be filtered in memory:
 * - an explicit `locationId` outside the caller's scope → 403;
 * - a single-location caller with no filter is pinned to their one location;
 * - a multi-location caller with no filter → 400 `locationId is required for a
 *   multi-location caller` — the route refuses to guess a location rather than
 *   silently widening to all of them;
 * - an unscoped caller (empty `locationIds`) sees the whole organization and may
 *   narrow by `locationId` or `employeeId`.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKED_HOURS_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseWorkedHoursQuery(new URL(request.url).searchParams);
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
    const store = createPostgresSchedulingStore(getDb().db);

    let report;
    try {
      report = await computeWorkedHours(store, {
        organizationId,
        from: parsed.query.from,
        to: parsed.query.to,
        ...(locationId === undefined ? {} : { locationId }),
        ...(parsed.query.employeeId === undefined ? {} : { employeeId: parsed.query.employeeId }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({
      from: report.from,
      to: report.to,
      rows: report.rows,
      totalHours: report.totalHours,
    });
  });
}
