import {
  createPostgresFileObjectsStore,
  createPostgresSchedulingStore,
  findPayrollReport,
  markPayrollReportExported,
  storeFileObject,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../lib/file-storage";
import { isMultipart, parseUploadForm } from "../../../../../../../lib/file-upload";
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
  PAYROLL_EXPORT_RETENTION_POLICY,
  PAYROLL_EXPORT_UPLOAD_POLICY,
  parseMarkPayrollReportExportedBody,
  toPayrollReportRow,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks one payroll-input report exported (`WF-005`, row 14b-2) and, when the
 * request carries a file, stores the export artefact first (`DEC-133`,
 * extending the `DEC-132` port to the payroll-export consumer).
 *
 * Two body shapes are accepted. `multipart/form-data` with a required `file`
 * part stores the CSV/PDF through `storeFileObject`, linked to the report
 * (`linked_entity_type = 'payroll_report'`), and passes its id to the command;
 * the JSON shape `{ exportFileId? }` remains for callers that mark the status
 * without producing a file. The report is resolved organization-scoped before a
 * multipart upload is stored, and only a `generated` report accepts one, so a
 * rejected upload leaves no artefact behind. A rejected type or an oversize
 * file is a 400 and stores nothing.
 *
 * Limited to owner / general_manager / finance / admin. The actor is the session
 * user. An unknown or cross-organization report is a typed `NotFoundError` →
 * 404, and any other command rejection a `DomainError` → 400.
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

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    if (isMultipart(request)) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError(400);
      }
      const parsedUpload = await parseUploadForm(form, PAYROLL_EXPORT_UPLOAD_POLICY);
      if (!parsedUpload.ok) {
        return jsonError(400);
      }

      const report = await findPayrollReport(store, { organizationId, payrollReportId: id });
      if (report === undefined) {
        return jsonError(404);
      }
      if (report.status !== "generated") {
        return jsonError(400, `payroll report in state ${report.status} cannot be exported`);
      }

      let file;
      try {
        file = await storeFileObject(createPostgresFileObjectsStore(getDb().db), getFileStorage(), {
          organizationId,
          actorId: session.userId,
          filename: parsedUpload.upload.filename,
          mime: parsedUpload.upload.mime,
          retentionPolicy: PAYROLL_EXPORT_RETENTION_POLICY,
          bytes: parsedUpload.upload.bytes,
          linkedEntityType: "payroll_report",
          linkedEntityId: report.id,
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(400, error.message);
        }
        throw error;
      }

      let exported;
      try {
        exported = await markPayrollReportExported(store, {
          organizationId,
          payrollReportId: id,
          actorId: session.userId,
          exportFileId: file.id,
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
        }
        throw error;
      }

      return jsonOk({
        payrollReport: toPayrollReportRow(organizationId, exported),
        fileObjectId: file.id,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
      });
    }

    const parsed = parseMarkPayrollReportExportedBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

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
