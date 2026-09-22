import { createPostgresSchedulingStore, findPayrollReport } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  PAYROLL_REPORT_READ_ROLES,
} from "../../access";
import { isUuid, toPayrollReportRow } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One payroll-input report by id (`WF-005`, row 14b-2).
 *
 * Signed out → 401; a role outside the `Payroll-input reports` row (owner /
 * general_manager / finance / admin; `location_manager` is matrix None) → 403; a
 * non-UUID id → 400. The read is organization-scoped, so an unknown or
 * cross-organization id is a 404 (`DEC-061`). The report is an organization-level
 * aggregate with no location column, so there is no location-scope check.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, PAYROLL_REPORT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);
    const report = await findPayrollReport(store, { organizationId, payrollReportId: id });
    if (report === undefined) {
      return jsonError(404);
    }

    return jsonOk({ payrollReport: toPayrollReportRow(organizationId, report) });
  });
}
