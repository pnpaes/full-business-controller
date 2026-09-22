import type { SchedulingStore, ShiftRecord } from "./types";

export interface FindShiftQuery {
  readonly organizationId: string;
  readonly shiftId: string;
}

/**
 * One shift by id, organization-scoped (`DEC-061`), or `undefined`. A missing id
 * and another tenant's id are indistinguishable, so a caller cannot probe for
 * the existence of a shift outside its organization.
 */
export async function findShift(
  store: SchedulingStore,
  query: FindShiftQuery,
): Promise<ShiftRecord | undefined> {
  return store.findShift({
    organizationId: query.organizationId,
    shiftId: query.shiftId,
  });
}
