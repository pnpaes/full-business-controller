import type { AssignableUser, TaskStore } from "./types";

export interface ListAssignableUsersQuery {
  readonly organizationId: string;
}

/**
 * The candidate assignees for the task picker (`DEC-122`): the organization's
 * **active** `app_user` rows reduced to `(id, displayName, username)`. This is
 * the smallest honest read — there is no user-directory service — and it is
 * organization-scoped (`DEC-061`), so a caller can never see another tenant's
 * users. Disabled/locked/invited users are excluded, so the picker cannot
 * assign work to an off-boarded account.
 */
export async function listAssignableUsers(
  store: TaskStore,
  query: ListAssignableUsersQuery,
): Promise<readonly AssignableUser[]> {
  return store.listAssignableUsers({ organizationId: query.organizationId });
}
