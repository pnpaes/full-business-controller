import { resolveSelfEmployee } from "./resolve-self-employee";
import type { MyShiftRow, SchedulingStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_MY_SHIFT_LIMIT = 200;

export interface ListMyShiftsQuery {
  readonly organizationId: string;
  /** The signed-in `app_user`; resolved to their sole linked employee row. */
  readonly actorUserId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The signed-in employee's own shifts (`WF-003`, `DEC-146`). The `app_user` id
 * resolves to their single linked employee row (zero or more than one fails
 * closed), and the read is then scoped to that employee, so a caller can only
 * ever see their own assignments. `limit` defaults to `DEFAULT_MY_SHIFT_LIMIT`
 * so the page is bounded.
 */
export async function listMyShifts(
  store: SchedulingStore,
  query: ListMyShiftsQuery,
): Promise<readonly MyShiftRow[]> {
  const employee = resolveSelfEmployee(
    await store.findEmployeesByUserId({
      organizationId: query.organizationId,
      userId: query.actorUserId,
    }),
  );

  return store.listMyShifts({
    organizationId: query.organizationId,
    employeeId: employee.id,
    limit: query.limit ?? DEFAULT_MY_SHIFT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
