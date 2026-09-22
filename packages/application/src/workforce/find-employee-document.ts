import type { EmployeeDocumentRecord, WorkforceStore } from "./types";

export interface FindEmployeeDocumentQuery {
  readonly organizationId: string;
  readonly employeeDocumentId: string;
}

/**
 * One personnel document by id, organization-scoped (`DEC-061`), or
 * `undefined`. A missing id and another tenant's id are indistinguishable, so a
 * caller cannot probe for the existence of a document outside its organization.
 */
export async function findEmployeeDocument(
  store: WorkforceStore,
  query: FindEmployeeDocumentQuery,
): Promise<EmployeeDocumentRecord | undefined> {
  return store.findEmployeeDocument({
    organizationId: query.organizationId,
    employeeDocumentId: query.employeeDocumentId,
  });
}
