import type { PayrollReportRecord, SchedulingStore } from "./types";

export interface FindPayrollReportQuery {
  readonly organizationId: string;
  readonly payrollReportId: string;
}

/**
 * One payroll report by id, organization-scoped (`DEC-061`), or `undefined`. A
 * missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of a report outside its organization.
 */
export async function findPayrollReport(
  store: SchedulingStore,
  query: FindPayrollReportQuery,
): Promise<PayrollReportRecord | undefined> {
  return store.findPayrollReport({
    organizationId: query.organizationId,
    payrollReportId: query.payrollReportId,
  });
}
