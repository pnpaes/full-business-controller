import type { EmployeeRecord, WorkforceStore } from "./types";

export interface FindEmployeeQuery {
  readonly organizationId: string;
  readonly employeeId: string;
}

/**
 * One employee by id, organization-scoped (`DEC-061`), or `undefined`. A missing
 * id and another tenant's id are indistinguishable, so a caller cannot probe for
 * the existence of an employee outside its organization.
 */
export async function findEmployee(
  store: WorkforceStore,
  query: FindEmployeeQuery,
): Promise<EmployeeRecord | undefined> {
  return store.findEmployee({
    organizationId: query.organizationId,
    employeeId: query.employeeId,
  });
}
