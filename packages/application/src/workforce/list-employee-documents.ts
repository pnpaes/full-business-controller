import type { EmployeeDocumentRecord, WorkforceStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_EMPLOYEE_DOCUMENT_LIMIT = 50;

export interface ListEmployeeDocumentsQuery {
  readonly organizationId: string;
  readonly employeeId?: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND`, exact match. */
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Personnel documents for one organization, ordered by `title` then id, with
 * optional employee and kind filters. The organization filter is never optional,
 * so a caller cannot read another tenant's documents (`DEC-061`); `limit`
 * defaults to `DEFAULT_EMPLOYEE_DOCUMENT_LIMIT` so a caller cannot ask for the
 * whole library unbounded.
 */
export async function listEmployeeDocuments(
  store: WorkforceStore,
  query: ListEmployeeDocumentsQuery,
): Promise<readonly EmployeeDocumentRecord[]> {
  return store.listEmployeeDocuments({
    organizationId: query.organizationId,
    ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    limit: query.limit ?? DEFAULT_EMPLOYEE_DOCUMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
