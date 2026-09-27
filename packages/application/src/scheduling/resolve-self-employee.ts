import { DomainError, NotFoundError } from "@aquarela/domain";

import type { SchedulingEmployeeRecord, SchedulingStore } from "./types";

/**
 * Resolves the one employee row linked to a signed-in `app_user` (`WF-003`,
 * `DEC-146`). `employee.user_id` has **no unique constraint**, so the lookup is
 * a list and this helper fails closed on both degenerate cases: zero rows means
 * the account is not an employee (`NotFoundError`), and more than one means the
 * link is ambiguous and the account is refused (`DomainError`) rather than
 * picked arbitrarily. Only an unambiguous link yields the employee.
 */
export function resolveSelfEmployee(
  rows: readonly SchedulingEmployeeRecord[],
): SchedulingEmployeeRecord {
  if (rows.length === 0) {
    throw new NotFoundError("no employee record is linked to this account");
  }
  if (rows.length > 1) {
    throw new DomainError("multiple employee records are linked to this account");
  }
  return rows[0]!;
}

/**
 * The route-level gate for the employee self-service surfaces (`DEC-146`):
 * resolves the linked employee or `undefined` when the account is not an
 * employee (zero rows) or the link is ambiguous (more than one), so the caller
 * can fail closed with a 403 without distinguishing the two cases. The commands
 * still resolve for themselves — this is a cheap pre-check, not the authority.
 */
export async function findSelfEmployee(
  store: SchedulingStore,
  input: { readonly organizationId: string; readonly actorUserId: string },
): Promise<SchedulingEmployeeRecord | undefined> {
  const rows = await store.findEmployeesByUserId({
    organizationId: input.organizationId,
    userId: input.actorUserId,
  });
  return rows.length === 1 ? rows[0]! : undefined;
}
