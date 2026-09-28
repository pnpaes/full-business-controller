import { resolveSelfEmployee } from "./resolve-self-employee";
import type { AvailableShiftRow, SchedulingStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_AVAILABLE_SHIFT_LIMIT = 200;

export interface ListAvailableShiftsQuery {
  readonly organizationId: string;
  /** The signed-in `app_user`; resolved to their sole linked employee row. */
  readonly actorUserId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The shifts the signed-in employee may self-assign (`DEC-151`): `open` or
 * `published` shifts at the employee's primary location whose position the
 * employee holds (or with no position), excluding shifts they already hold an
 * assignment for. The `app_user` id resolves to their single linked employee row
 * (zero or more than one fails closed, `resolveSelfEmployee`). An employee with
 * no primary location has no available shifts (fail-closed) — an empty list, not
 * an error, because that is a legible empty state.
 */
export async function listAvailableShifts(
  store: SchedulingStore,
  query: ListAvailableShiftsQuery,
): Promise<readonly AvailableShiftRow[]> {
  const employee = resolveSelfEmployee(
    await store.findEmployeesByUserId({
      organizationId: query.organizationId,
      userId: query.actorUserId,
    }),
  );
  if (employee.primaryLocationId === null) {
    return [];
  }
  const positionIds = await store.listEmployeePositionIds({
    organizationId: query.organizationId,
    employeeId: employee.id,
  });
  return store.listAvailableShifts({
    organizationId: query.organizationId,
    employeeId: employee.id,
    locationId: employee.primaryLocationId,
    positionIds,
    limit: query.limit ?? DEFAULT_AVAILABLE_SHIFT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
