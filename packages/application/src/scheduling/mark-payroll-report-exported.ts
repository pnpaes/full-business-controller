import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { PayrollReportRecord, SchedulingStore } from "./types";

export interface MarkPayrollReportExportedInput {
  readonly organizationId: string;
  readonly payrollReportId: string;
  /** The exported artifact's `file_object` id; omitted leaves the link untouched. */
  readonly exportFileId?: string;
  readonly actorId: string;
}

/**
 * Marks one payroll report as `exported` (`WF-005`, `DEC-037`) and optionally
 * links the exported `file_object`. The report is loaded organization-scoped
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`) and
 * only a `generated` report may be exported — a `draft`, already-`exported` or
 * `superseded` report is a `DomainError` rather than a silent re-export. The
 * status change (and the export link, when given) and its audit fact commit or
 * roll back together.
 */
export async function markPayrollReportExported(
  store: SchedulingStore,
  input: MarkPayrollReportExportedInput,
): Promise<PayrollReportRecord> {
  if (isBlank(input.payrollReportId)) {
    throw new DomainError("payrollReportId is required");
  }

  return store.withTransaction(async (tx) => {
    const report = await tx.findPayrollReport({
      organizationId: input.organizationId,
      payrollReportId: input.payrollReportId.trim(),
    });
    if (report === undefined) {
      throw new NotFoundError("payroll report not found in organization");
    }
    if (report.status !== "generated") {
      throw new DomainError(`payroll report in state ${report.status} cannot be exported`);
    }

    const updated = await tx.updatePayrollReport({
      organizationId: input.organizationId,
      payrollReportId: report.id,
      status: "exported",
      ...(input.exportFileId === undefined ? {} : { exportFileId: input.exportFileId }),
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("payroll report not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.payrollReportExported,
      entityType: "payroll_report",
      entityId: updated.id,
      before: { status: report.status, export_file_id: report.exportFileId },
      after: { status: updated.status, export_file_id: updated.exportFileId },
    });

    return updated;
  });
}
