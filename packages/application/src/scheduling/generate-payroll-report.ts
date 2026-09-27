import { DomainError, NotFoundError, buildPayrollSnapshot } from "@aquarela/domain";

import { assertOptionalCalendarDate } from "../hms/register-incident";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import { computeWorkedHours } from "./compute-worked-hours";
import type { PayrollReportRecord, SchedulingStore } from "./types";

/** The calendar day after `value` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
function nextCalendarDay(value: string): string {
  const next = Date.parse(`${value}T00:00:00.000Z`) + 86_400_000;
  return new Date(next).toISOString().slice(0, 10);
}

export interface GeneratePayrollReportInput {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`; must be after `periodStart`. */
  readonly periodEnd: string;
  /** The acting user; `null` means system-initiated (e.g. the scheduler cron). */
  readonly actorId: string | null;
}

/**
 * Generates the monthly payroll-**input** report for one period (`WF-005`,
 * `DEC-037`): derives the per-employee worked hours for the whole period,
 * freezes them into a snapshot line per employee (hours × base hourly rate =
 * expected pay) and stores the report with status `generated`.
 *
 * The period is the **half-open instant window** `[periodStart T00:00:00Z,
 * dayAfter(periodEnd) T00:00:00Z)`, so the whole `periodEnd` day is included;
 * `computeWorkedHours` selects the approved assignments whose shift starts in
 * that window. `periodStart`/`periodEnd` must be `YYYY-MM-DD` calendar dates and
 * `periodEnd > periodStart` (`DomainError` otherwise).
 *
 * **Supersede:** `(organization_id, period_start)` is the partial unique
 * `payroll_report_org_period_key` (it excludes `superseded` rows), so a prior
 * report for the same period that is not already `superseded` is first moved to
 * `superseded` (audited `payrollReportSuperseded`) and only then is the
 * replacement inserted (`generated`, audited `payrollReportGenerated`). The
 * prior live report is resolved through `lockPayrollReportForPeriod`
 * (`SELECT … FOR UPDATE`), so two concurrent generations for one period
 * serialise rather than both passing the existence check. The report, its
 * supersede and both audit facts commit or roll back together.
 */
export async function generatePayrollReport(
  store: SchedulingStore,
  input: GeneratePayrollReportInput,
): Promise<PayrollReportRecord> {
  assertOptionalCalendarDate(input.periodStart, "periodStart");
  assertOptionalCalendarDate(input.periodEnd, "periodEnd");
  if (
    Date.parse(`${input.periodEnd}T00:00:00.000Z`) <=
    Date.parse(`${input.periodStart}T00:00:00.000Z`)
  ) {
    throw new DomainError("periodEnd must be after periodStart");
  }

  const from = `${input.periodStart}T00:00:00.000Z`;
  const to = `${nextCalendarDay(input.periodEnd)}T00:00:00.000Z`;

  return store.withTransaction(async (tx) => {
    const worked = await computeWorkedHours(tx, {
      organizationId: input.organizationId,
      from,
      to,
    });

    const snapshot = buildPayrollSnapshot({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      lines: worked.rows.map((row) => ({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        roleCode: row.roleCode,
        hours: row.hours,
        hourlyRate: row.hourlyRate,
      })),
    });

    const existing = await tx.lockPayrollReportForPeriod({
      organizationId: input.organizationId,
      periodStart: input.periodStart,
    });
    if (existing !== undefined && existing.status !== "superseded") {
      const superseded = await tx.updatePayrollReport({
        organizationId: input.organizationId,
        payrollReportId: existing.id,
        status: "superseded",
        actorId: input.actorId,
      });
      if (superseded === undefined) {
        throw new NotFoundError("payroll report not found in organization");
      }
      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: SCHEDULING_AUDIT_ACTIONS.payrollReportSuperseded,
        entityType: "payroll_report",
        entityId: superseded.id,
        before: { status: existing.status },
        after: { status: superseded.status },
      });
    }

    const report = await tx.createPayrollReport({
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      generatedBy: input.actorId,
      status: "generated",
      snapshot,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.payrollReportGenerated,
      entityType: "payroll_report",
      entityId: report.id,
      after: {
        period_start: report.periodStart,
        period_end: report.periodEnd,
        status: report.status,
        total_hours: snapshot.totalHours,
        total_expected_pay: snapshot.totalExpectedPay,
        line_count: snapshot.lines.length,
      },
    });

    return report;
  });
}
