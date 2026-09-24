import { DomainError } from "@aquarela/domain";

import type { AuthStore, AuthUserSummary } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_USER_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole directory in one page. */
export const MAX_USER_LIMIT = 200;

export interface ListUsersQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One page of the organization's users for the management surface
 * (`07_SECURITY_AND_NFR.md` §7.1 "Users/configuration"), ordered by display name
 * (then id). Each row carries the user's roles and location scopes, so the screen
 * renders a management row without an N+1 per-user read; the page is bounded, so
 * the join stays cheap. The organization filter is never optional, so a caller
 * cannot read another tenant's users (`DEC-061`); `limit` defaults to
 * `DEFAULT_USER_LIMIT` and is validated against `MAX_USER_LIMIT`. Credential
 * material (`password_hash`, TOTP secrets, recovery codes) is never returned.
 */
export async function listUsers(
  store: AuthStore,
  query: ListUsersQuery,
): Promise<readonly AuthUserSummary[]> {
  const limit = query.limit ?? DEFAULT_USER_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_USER_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_USER_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  return store.listUsers({
    organizationId: query.organizationId,
    limit,
    offset,
  });
}
