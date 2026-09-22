import type { SchedulingStore, ShiftAdjustmentRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_SHIFT_ADJUSTMENT_LIMIT = 50;

export interface ListShiftAdjustmentsQuery {
  readonly organizationId: string;
  readonly shiftAssignmentId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Worked-hours corrections for one organization, newest first, with an optional
 * assignment filter. The organization filter is never optional, so a caller
 * cannot read another tenant's corrections (`DEC-061`); `limit` defaults to
 * `DEFAULT_SHIFT_ADJUSTMENT_LIMIT` so a caller cannot ask for the whole history
 * unbounded. `createdAt desc, id asc` ordering matches the persistence layer.
 */
export async function listShiftAdjustments(
  store: SchedulingStore,
  query: ListShiftAdjustmentsQuery,
): Promise<readonly ShiftAdjustmentRecord[]> {
  return store.listShiftAdjustments({
    organizationId: query.organizationId,
    ...(query.shiftAssignmentId === undefined
      ? {}
      : { shiftAssignmentId: query.shiftAssignmentId }),
    limit: query.limit ?? DEFAULT_SHIFT_ADJUSTMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
