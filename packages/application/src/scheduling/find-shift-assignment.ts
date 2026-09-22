import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

export interface FindShiftAssignmentQuery {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
}

/**
 * One shift assignment by id, organization-scoped (`DEC-061`), or `undefined`.
 * A missing id and another tenant's id are indistinguishable, so a caller
 * cannot probe for the existence of an assignment outside its organization.
 */
export async function findShiftAssignment(
  store: SchedulingStore,
  query: FindShiftAssignmentQuery,
): Promise<ShiftAssignmentRecord | undefined> {
  return store.findShiftAssignment({
    organizationId: query.organizationId,
    shiftAssignmentId: query.shiftAssignmentId,
  });
}
