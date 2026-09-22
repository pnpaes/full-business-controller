import type { SchedulingStore, ShiftAdjustmentRecord } from "./types";

export interface FindShiftAdjustmentQuery {
  readonly organizationId: string;
  readonly shiftAdjustmentId: string;
}

/**
 * One worked-hours correction by id, organization-scoped (`DEC-061`), or
 * `undefined`. A missing id and another tenant's id are indistinguishable, so a
 * caller cannot probe for the existence of a correction outside its
 * organization.
 */
export async function findShiftAdjustment(
  store: SchedulingStore,
  query: FindShiftAdjustmentQuery,
): Promise<ShiftAdjustmentRecord | undefined> {
  return store.findShiftAdjustment({
    organizationId: query.organizationId,
    shiftAdjustmentId: query.shiftAdjustmentId,
  });
}
