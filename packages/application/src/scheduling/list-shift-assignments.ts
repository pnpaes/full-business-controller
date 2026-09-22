import { DomainError } from "@aquarela/domain";

import { SHIFT_ASSIGNMENT_STATES } from "./types";
import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_SHIFT_ASSIGNMENT_LIMIT = 50;

export interface ListShiftAssignmentsQuery {
  readonly organizationId: string;
  readonly shiftId?: string;
  readonly employeeId?: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`, exact match. */
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shift assignments for one organization, with optional shift, employee and
 * state filters. The organization filter is never optional, so a caller cannot
 * read another tenant's assignments (`DEC-061`); a provided `state` is checked
 * against `SHIFT_ASSIGNMENT_STATES` here so a bogus filter is a `DomainError`
 * rather than a silently empty page; `limit` defaults to
 * `DEFAULT_SHIFT_ASSIGNMENT_LIMIT` so a caller cannot ask for the whole set
 * unbounded.
 */
export async function listShiftAssignments(
  store: SchedulingStore,
  query: ListShiftAssignmentsQuery,
): Promise<readonly ShiftAssignmentRecord[]> {
  if (query.state !== undefined && !SHIFT_ASSIGNMENT_STATES.includes(query.state)) {
    throw new DomainError(`state must be one of ${SHIFT_ASSIGNMENT_STATES.join(", ")}`);
  }

  return store.listShiftAssignments({
    organizationId: query.organizationId,
    ...(query.shiftId === undefined ? {} : { shiftId: query.shiftId }),
    ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
    ...(query.state === undefined ? {} : { state: query.state }),
    limit: query.limit ?? DEFAULT_SHIFT_ASSIGNMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
