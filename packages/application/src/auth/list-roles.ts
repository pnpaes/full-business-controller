import type { AuthRoleRecord, AuthStore } from "./types";

export interface ListRolesQuery {
  readonly organizationId: string;
}

/**
 * Every role defined for the organization — the assignable catalogue the
 * management surface grants from (`07_SECURITY_AND_NFR.md` §7.1
 * "Users/configuration"), ordered by code (then id). The organization filter is
 * never optional (`DEC-061`), so a caller cannot read another tenant's role
 * catalogue.
 */
export async function listRoles(
  store: AuthStore,
  query: ListRolesQuery,
): Promise<readonly AuthRoleRecord[]> {
  return store.listRoles(query.organizationId);
}
