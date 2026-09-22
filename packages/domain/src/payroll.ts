import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { MONEY_SCALE } from "./money";
import { WORKED_HOURS_SCALE } from "./scheduling";

/**
 * The monthly payroll-**input** report's frozen snapshot (`WF-005`, `DEC-037`).
 *
 * A report is a payroll-input artifact only: statutory payroll processing, tax
 * withholding and payslips stay out of scope. The snapshot is built once, when
 * the report is generated, from the worked hours and the employees' base hourly
 * rates, and is then immutable — a later shift or `shift_adjustment` edit cannot
 * rewrite an already-issued report. Decimal only, never floats
 * (`13_AGENT_BUILD_BRIEF.md`, `CALCULATION_CONTRACT`).
 */

/** The shape version of the stored `payroll_report.snapshot` jsonb. */
export const PAYROLL_SNAPSHOT_VERSION = 1;

/** One frozen report line: an employee's hours, rate and expected pay. */
export interface PayrollSnapshotLine {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** `numeric(9,2)` hours, a decimal string. */
  readonly hours: string;
  /** `numeric(19,4)` money, a decimal string. */
  readonly hourlyRate: string;
  /** `numeric(19,4)` money; `hours × hourlyRate` rounded HALF_UP. */
  readonly expectedPay: string;
}

/** The frozen, reproducible contents of a payroll-input report. */
export interface PayrollSnapshot {
  readonly schemaVersion: number;
  /** The organization's currency; the schema carries no currency column. */
  readonly currency: "NOK";
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lines: readonly PayrollSnapshotLine[];
  /** Sum of every line's hours, at `WORKED_HOURS_SCALE`. */
  readonly totalHours: string;
  /** Sum of every line's expected pay, at `MONEY_SCALE`. */
  readonly totalExpectedPay: string;
}

export interface BuildPayrollSnapshotInput {
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  readonly lines: readonly {
    readonly employeeId: string;
    readonly employeeName: string;
    readonly roleCode: string;
    /** `numeric(9,2)` hours, a decimal string. */
    readonly hours: string;
    /** `numeric(19,4)` money, a decimal string. */
    readonly hourlyRate: string;
  }[];
}

/**
 * Builds the frozen payroll snapshot: for every input line `expectedPay =
 * hours × hourlyRate` at money scale (`numeric(19,4)`, `MONEY_SCALE`) HALF_UP.
 * Hours are parsed at `WORKED_HOURS_SCALE` (2) and the rate at money scale (4),
 * so the BigInt product is scaled by 6 and one HALF_UP division brings it back to
 * 4 dp. Lines are ordered by `employeeName asc, employeeId asc`; `totalHours`
 * sums the hours at `WORKED_HOURS_SCALE` and `totalExpectedPay` sums the expected
 * pay at money scale. An empty line set is a valid empty report with zero
 * totals.
 */
export function buildPayrollSnapshot(input: BuildPayrollSnapshotInput): PayrollSnapshot {
  const lines = input.lines
    .map((line) => {
      const hours = parseDecimal(line.hours, WORKED_HOURS_SCALE);
      const hourlyRate = parseDecimal(line.hourlyRate, MONEY_SCALE);
      const expectedPay = divideRoundHalfUp(hours * hourlyRate, 10n ** BigInt(WORKED_HOURS_SCALE));
      return {
        employeeId: line.employeeId,
        employeeName: line.employeeName,
        roleCode: line.roleCode,
        hours: formatDecimal(hours, WORKED_HOURS_SCALE),
        hourlyRate: formatDecimal(hourlyRate, MONEY_SCALE),
        expectedPay: formatDecimal(expectedPay, MONEY_SCALE),
      };
    })
    .sort((a, b) => {
      if (a.employeeName !== b.employeeName) return a.employeeName < b.employeeName ? -1 : 1;
      if (a.employeeId !== b.employeeId) return a.employeeId < b.employeeId ? -1 : 1;
      return 0;
    });

  let totalHours = 0n;
  let totalExpectedPay = 0n;
  for (const line of lines) {
    totalHours += parseDecimal(line.hours, WORKED_HOURS_SCALE);
    totalExpectedPay += parseDecimal(line.expectedPay, MONEY_SCALE);
  }

  return {
    schemaVersion: PAYROLL_SNAPSHOT_VERSION,
    currency: "NOK",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lines,
    totalHours: formatDecimal(totalHours, WORKED_HOURS_SCALE),
    totalExpectedPay: formatDecimal(totalExpectedPay, MONEY_SCALE),
  };
}

/** The `payroll_report_status` vocabulary (`DEC-037`; provisional, `DEC-104`). */
const PAYROLL_REPORT_STATUSES = ["draft", "generated", "exported", "superseded"] as const;

/** Whether `value` is one of the four `payroll_report_status` values. */
export function isPayrollReportStatus(value: string): boolean {
  return (PAYROLL_REPORT_STATUSES as readonly string[]).includes(value);
}
