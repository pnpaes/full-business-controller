import { createPostgresSchedulingStore, markPayrollReportExported } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  PAYROLL_REPORT_WRITE_ROLES,
} from "../../../access";
import { shiftLimiters } from "../../../limiters";
import {
  isUuid,
  parseMarkPayrollReportExportedBody,
  toPayrollReportRow,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks one payroll-input report exported (`WF-005`, row 14b-2): the report is
 * frozen, so this records the `exported` status transition and, when supplied,
 * the `export_file_id` of the restricted export file (`export_file_id` is a
 * deferred `file_object` FK, `DEC-085`). Limited to owner / general_manager /
 * finance / admin. The actor is the session user.
 *
 * The body is optional: `{ exportFileId? }`, a UUID when present (else 400). A
 * non-UUID id is a 400. There is no location scope (the report is an
 * organization-level aggregate). An unknown or cross-organization report is a
 * typed `NotFoundError` → 404, and any other command rejection a `DomainError` →
 * 400 (for example a regeneration/export transition the report's status forbids).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.markPayrollReportExported, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, PAYROLL_REPORT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseMarkPayrollReportExportedBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    let report;
    try {
      report = await markPayrollReportExported(store, {
        organizationId,
        payrollReportId: id,
        actorId: session.userId,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ payrollReport: toPayrollReportRow(organizationId, report) });
  });
}
