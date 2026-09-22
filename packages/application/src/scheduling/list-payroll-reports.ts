import { DomainError } from "@aquarela/domain";

import { PAYROLL_REPORT_STATUSES } from "./types";
import type { PayrollReportRecord, SchedulingStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_PAYROLL_REPORT_LIMIT = 50;

export interface ListPayrollReportsQuery {
  readonly organizationId: string;
  /** One of `PAYROLL_REPORT_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start`; `YYYY-MM-DD`. */
  readonly periodStartFrom?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Payroll reports for one organization, newest period first, with optional
 * status and period-start filters. The organization filter is never optional, so
 * a caller cannot read another tenant's reports (`DEC-061`); a provided `status`
 * is checked against `PAYROLL_REPORT_STATUSES` here so a bogus filter is a
 * `DomainError` rather than a silently empty page; `limit` defaults to
 * `DEFAULT_PAYROLL_REPORT_LIMIT` so a caller cannot ask for every report
 * unbounded.
 */
export async function listPayrollReports(
  store: SchedulingStore,
  query: ListPayrollReportsQuery,
): Promise<readonly PayrollReportRecord[]> {
  if (query.status !== undefined && !PAYROLL_REPORT_STATUSES.includes(query.status)) {
    throw new DomainError(`status must be one of ${PAYROLL_REPORT_STATUSES.join(", ")}`);
  }

  return store.listPayrollReports({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.periodStartFrom === undefined ? {} : { periodStartFrom: query.periodStartFrom }),
    limit: query.limit ?? DEFAULT_PAYROLL_REPORT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
