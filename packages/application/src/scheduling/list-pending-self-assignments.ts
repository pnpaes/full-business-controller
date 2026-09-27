import type { PendingSelfAssignmentRow, SchedulingStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_PENDING_SELF_ASSIGNMENT_LIMIT = 200;

export interface ListPendingSelfAssignmentsQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The manager review queue (`WF-003`, `DEC-146`): the self-originated
 * `pending_approval` assignments for one organization, joined to their shift and
 * employee. The organization filter is never optional (`DEC-061`) and the
 * route additionally applies the caller's location scope; `limit` defaults to
 * `DEFAULT_PENDING_SELF_ASSIGNMENT_LIMIT` so the page is bounded.
 */
export async function listPendingSelfAssignments(
  store: SchedulingStore,
  query: ListPendingSelfAssignmentsQuery,
): Promise<readonly PendingSelfAssignmentRow[]> {
  return store.listPendingSelfAssignments({
    organizationId: query.organizationId,
    limit: query.limit ?? DEFAULT_PENDING_SELF_ASSIGNMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
