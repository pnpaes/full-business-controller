import { DomainError } from "@aquarela/domain";

import type { EmployeeRecord, WorkforceStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_EMPLOYEE_LIMIT = 50;

export interface ListEmployeesQuery {
  readonly organizationId: string;
  readonly primaryLocationId?: string;
  /** `true` = not retired (`retired_at` null); `false` = retired. */
  readonly active?: boolean;
  /** `true` = retired (`retired_at` set); `false` = not retired. */
  readonly retired?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Employees for one organization, ordered by `name` then id, with optional
 * primary-location, active and retired filters (`active` is the not-retired
 * filter and `retired` its complement — employees are retired, never deleted).
 * The organization filter is never optional, so a caller cannot read another
 * tenant's register (`DEC-061`); `limit` defaults to `DEFAULT_EMPLOYEE_LIMIT`
 * so a caller cannot ask for the whole register unbounded.
 *
 * Because the two filters are complements, asking for the same value on both is
 * contradictory and can only ever return nothing; that is rejected as a
 * `DomainError` rather than silently answered with an empty page.
 */
export async function listEmployees(
  store: WorkforceStore,
  query: ListEmployeesQuery,
): Promise<readonly EmployeeRecord[]> {
  if (query.active !== undefined && query.retired !== undefined && query.active === query.retired) {
    throw new DomainError("active and retired are complementary filters and cannot agree");
  }

  return store.listEmployees({
    organizationId: query.organizationId,
    ...(query.primaryLocationId === undefined
      ? {}
      : { primaryLocationId: query.primaryLocationId }),
    ...(query.active === undefined ? {} : { active: query.active }),
    ...(query.retired === undefined ? {} : { retired: query.retired }),
    limit: query.limit ?? DEFAULT_EMPLOYEE_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
