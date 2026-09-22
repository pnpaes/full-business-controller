import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";

/**
 * Worked-hours derivation for the shift-scheduling slice (`WF-004`, `DEC-038`).
 *
 * Worked hours are derived from a registered shift: the assignment's planned
 * length minus its unpaid break, **unless** a `shift_adjustment` correction is
 * present, in which case the latest correction overrides the derivation
 * (`DATA_DICTIONARY` §4A: "correctors are recorded as `shift_adjustment` rows,
 * never by editing the shift"). Hours are stored at `numeric(9,2)`, so the
 * derivation is rounded to 2 dp HALF_UP. Decimal only, never floats
 * (`13_AGENT_BUILD_BRIEF.md`, `CALCULATION_CONTRACT`).
 */

/** The `numeric(9,2)` hours scale shared by `shift_adjustment.adjusted_hours`. */
export const WORKED_HOURS_SCALE = 2;

const MS_PER_MINUTE = 60_000n;
const MS_PER_HOUR = 3_600_000n;
const HOURS_SCALE_FACTOR = 10n ** BigInt(WORKED_HOURS_SCALE);

export interface WorkedHoursInput {
  /** `timestamptz`, ISO-8601. */
  readonly startsAt: string;
  /** `timestamptz`, ISO-8601. */
  readonly endsAt: string;
  /** Whole unpaid minutes; already validated non-negative by the caller. */
  readonly breakMinutes: number;
  /** The latest `shift_adjustment.adjusted_hours`, or null when none exists. */
  readonly adjustedHours: string | null;
}

/**
 * One assignment's worked hours, as a `numeric(9,2)` string. A non-null
 * `adjustedHours` is returned normalised to `WORKED_HOURS_SCALE` (a manual
 * correction always wins); otherwise the shift duration minus the break is
 * computed in milliseconds, floored at zero and rounded to 2 dp HALF_UP.
 */
export function deriveAssignmentHours(input: WorkedHoursInput): string {
  if (input.adjustedHours !== null) {
    return formatDecimal(parseDecimal(input.adjustedHours, WORKED_HOURS_SCALE), WORKED_HOURS_SCALE);
  }

  const startMs = Date.parse(input.startsAt);
  const endMs = Date.parse(input.endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new DomainError("startsAt and endsAt must be ISO-8601 instants");
  }
  if (!Number.isInteger(input.breakMinutes)) {
    throw new DomainError("breakMinutes must be an integer");
  }

  const netMs = BigInt(endMs - startMs) - BigInt(input.breakMinutes) * MS_PER_MINUTE;
  if (netMs <= 0n) {
    return formatDecimal(0n, WORKED_HOURS_SCALE);
  }
  return formatDecimal(
    divideRoundHalfUp(netMs * HOURS_SCALE_FACTOR, MS_PER_HOUR),
    WORKED_HOURS_SCALE,
  );
}

export interface WorkedHoursRow {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** `timestamptz`, ISO-8601. */
  readonly startsAt: string;
  /** `timestamptz`, ISO-8601. */
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly adjustedHours: string | null;
}

export interface WorkedHoursSummaryRow {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** `numeric(9,2)` hours at `WORKED_HOURS_SCALE`. */
  readonly hours: string;
}

/**
 * Sums one employee's assignments into a single `numeric(9,2)` hours figure,
 * ordered by `employeeName asc, employeeId asc`. The per-assignment
 * `deriveAssignmentHours` (so an adjustment overrides its own assignment) is
 * summed at `WORKED_HOURS_SCALE`; an empty input yields an empty array.
 */
export function sumWorkedHoursByEmployee(
  rows: readonly WorkedHoursRow[],
): readonly WorkedHoursSummaryRow[] {
  const totals = new Map<string, { employeeName: string; roleCode: string; hours: bigint }>();
  for (const row of rows) {
    const scaled = parseDecimal(deriveAssignmentHours(row), WORKED_HOURS_SCALE);
    const existing = totals.get(row.employeeId);
    if (existing === undefined) {
      totals.set(row.employeeId, {
        employeeName: row.employeeName,
        roleCode: row.roleCode,
        hours: scaled,
      });
    } else {
      existing.hours += scaled;
    }
  }

  return [...totals.entries()]
    .map(([employeeId, total]) => ({
      employeeId,
      employeeName: total.employeeName,
      roleCode: total.roleCode,
      hours: formatDecimal(total.hours, WORKED_HOURS_SCALE),
    }))
    .sort((a, b) => {
      if (a.employeeName !== b.employeeName) return a.employeeName < b.employeeName ? -1 : 1;
      if (a.employeeId !== b.employeeId) return a.employeeId < b.employeeId ? -1 : 1;
      return 0;
    });
}
