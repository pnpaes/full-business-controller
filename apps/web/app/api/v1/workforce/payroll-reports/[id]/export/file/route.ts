import {
  createPostgresFileObjectsStore,
  createPostgresSchedulingStore,
  findPayrollReport,
  readFileObject,
} from "@aquarela/application";

import { getDb } from "../../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../../lib/file-storage";
import { fileAttachmentResponse } from "../../../../../../../../lib/file-upload";
import { jsonError, mapErrors } from "../../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  PAYROLL_REPORT_READ_ROLES,
} from "../../../../access";
import { isUuid } from "../../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the stored export artefact of one payroll report (`DEC-133`), the
 * download half of the payroll-export consumer.
 *
 * Gated on the report read set (owner / general_manager / finance / admin), so
 * the bytes carry the same restriction as the report itself. The report and
 * then the file object are resolved **organization-scoped** (`DEC-061`), so an
 * unknown or cross-organization id is a 404 and cannot leak. A report with no
 * export file is a 404. Response: the bytes as a private attachment with
 * `nosniff` and `Cache-Control: private, no-store`.
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
    const db = getDb().db;
    const report = await findPayrollReport(createPostgresSchedulingStore(db), {
      organizationId,
      payrollReportId: id,
    });
    if (report === undefined || report.exportFileId === null) {
      return jsonError(404);
    }

    const stored = await readFileObject(createPostgresFileObjectsStore(db), getFileStorage(), {
      organizationId,
      fileObjectId: report.exportFileId,
    });
    if (stored === undefined) {
      return jsonError(404);
    }

    return fileAttachmentResponse(stored);
  });
}
