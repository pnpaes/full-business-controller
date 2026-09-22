import {
  DomainError,
  WORKED_HOURS_SCALE,
  formatDecimal,
  parseDecimal,
  sumWorkedHoursByEmployee,
} from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";

import type { SchedulingStore } from "./types";

export interface ComputeWorkedHoursQuery {
  readonly organizationId: string;
  /** ISO instant; window start, inclusive. */
  readonly from: string;
  /** ISO instant; window end, exclusive. */
  readonly to: string;
  readonly locationId?: string;
  readonly employeeId?: string;
}

export interface WorkedHoursSummary {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** `numeric(9,2)` hours. */
  readonly hours: string;
}

export interface WorkedHoursResult {
  readonly from: string;
  readonly to: string;
  readonly rows: readonly WorkedHoursSummary[];
  /** The sum of every row's hours, at `WORKED_HOURS_SCALE`. */
  readonly totalHours: string;
}

/**
 * Derives worked hours for one organization over `[from, to)` (`WF-004`,
 * `DEC-038`): the approved assignments on assigned/completed shifts whose shift
 * starts in the window, optionally narrowed by location and employee. `from` and
 * `to` must be ISO instants and `from < to` (a `DomainError` otherwise, before
 * the store is touched). The per-assignment derivation (an adjustment overrides
 * its own assignment) is summed per employee by the domain, and `totalHours` is
 * the sum of the returned rows at `WORKED_HOURS_SCALE`.
 */
export async function computeWorkedHours(
  store: SchedulingStore,
  query: ComputeWorkedHoursQuery,
): Promise<WorkedHoursResult> {
  assertIsoInstant(query.from, "from");
  assertIsoInstant(query.to, "to");
  if (Date.parse(query.from) >= Date.parse(query.to)) {
    throw new DomainError("from must be before to");
  }

  const assignments = await store.listWorkedHoursAssignments({
    organizationId: query.organizationId,
    from: query.from,
    to: query.to,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
  });

  const rows = sumWorkedHoursByEmployee(assignments);
  let total = 0n;
  for (const row of rows) {
    total += parseDecimal(row.hours, WORKED_HOURS_SCALE);
  }

  return {
    from: query.from,
    to: query.to,
    rows,
    totalHours: formatDecimal(total, WORKED_HOURS_SCALE),
  };
}
