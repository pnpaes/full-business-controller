import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import type { AuthRoleAssignment, AuthStore, RequestContext } from "./types";

export interface UserAccess {
  readonly roles: readonly string[];
  readonly locationIds: readonly string[];
}

export interface AccessRequirement {
  readonly role?: string;
  readonly locationId?: string;
}

/**
 * Loads a user's authorization from server data: role codes from `user_role`
 * (joined to `role`) and location ids from `user_location_scope`. Every
 * query/mutation must call this rather than trust client-supplied claims
 * (ADR-0003).
 */
export async function loadUserAccess(store: AuthStore, userId: string): Promise<UserAccess> {
  const [roles, locationIds] = await Promise.all([
    store.listUserRoles(userId),
    store.listUserLocationScopes(userId),
  ]);
  return {
    roles: [...new Set(roles.map((row) => row.code))],
    locationIds: [...new Set(locationIds)],
  };
}

/**
 * Pure authorization check: a required role must be present and a required
 * location must be in scope. There is no implicit admin bypass — `admin` grants
 * nothing unless it is explicitly in `access.roles`, so privilege comes only
 * from data.
 */
export function isAuthorizedFor(access: UserAccess, requirement: AccessRequirement): boolean {
  if (requirement.role !== undefined && !access.roles.includes(requirement.role)) {
    return false;
  }
  if (
    requirement.locationId !== undefined &&
    !access.locationIds.includes(requirement.locationId)
  ) {
    return false;
  }
  return true;
}

function roleSnapshot(
  roles: readonly AuthRoleAssignment[],
): Array<{ roleId: string; code: string; locationId: string | null }> {
  return roles
    .map(({ roleId, code, locationId }) => ({ roleId, code, locationId }))
    .sort(
      (a, b) =>
        a.code.localeCompare(b.code) || (a.locationId ?? "").localeCompare(b.locationId ?? ""),
    );
}

export interface AssignRoleInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly roleId: string;
  /** `null`/absent grants the role organization-wide. */
  readonly locationId?: string | null;
  readonly actorId: string | null;
  readonly request?: RequestContext;
}

/**
 * Grants a role and, because a role change is a privilege change, revokes every
 * session for that user in the same transaction (ADR-0003). Audits
 * `auth.access.role_changed` with the before/after role sets.
 */
export async function assignRole(
  store: AuthStore,
  input: AssignRoleInput,
  now = new Date(),
): Promise<void> {
  await store.withTransaction(async (tx) => {
    const before = await tx.listUserRoles(input.userId);
    await tx.assignRole({
      userId: input.userId,
      roleId: input.roleId,
      locationId: input.locationId ?? null,
      grantedBy: input.actorId,
    });
    const after = await tx.listUserRoles(input.userId);
    await tx.revokeAllSessionsForUser(input.userId, now);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: AUTH_AUDIT_ACTIONS.accessRoleChanged,
      entityId: input.userId,
      before: { roles: roleSnapshot(before) },
      after: { roles: roleSnapshot(after) },
      ...(input.request !== undefined ? { request: input.request } : {}),
    });
  });
}

export interface ReplaceLocationScopesInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly locationIds: readonly string[];
  readonly actorId: string | null;
  readonly request?: RequestContext;
}

/**
 * Replaces a user's location scope. Authorization is loaded live per request, so
 * a scope change does not require session revocation; the before/after sets are
 * audited as `auth.access.scopes_changed`.
 */
export async function replaceLocationScopes(
  store: AuthStore,
  input: ReplaceLocationScopesInput,
): Promise<void> {
  await store.withTransaction(async (tx) => {
    const before = await tx.listUserLocationScopes(input.userId);
    await tx.replaceLocationScopes(input.userId, input.locationIds);
    const after = await tx.listUserLocationScopes(input.userId);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: AUTH_AUDIT_ACTIONS.accessScopesChanged,
      entityId: input.userId,
      before: { locationIds: [...before].sort() },
      after: { locationIds: [...after].sort() },
      ...(input.request !== undefined ? { request: input.request } : {}),
    });
  });
}

export interface DisableUserInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly actorId: string | null;
  readonly reason?: string;
}

/**
 * Off-boards a user: sets `disabled` and revokes every session in one
 * transaction. Session validation also requires an active user, so a session
 * created concurrently with the revocation still fails to authenticate.
 */
export async function disableUser(
  store: AuthStore,
  input: DisableUserInput,
  now = new Date(),
): Promise<void> {
  await store.withTransaction(async (tx) => {
    const user = await tx.findUserById(input.userId);
    await tx.setUserStatus(input.userId, "disabled");
    const revoked = await tx.revokeAllSessionsForUser(input.userId, now);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: AUTH_AUDIT_ACTIONS.userDisabled,
      entityId: input.userId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      before: { status: user?.status ?? null },
      after: { status: "disabled", revokedSessions: revoked },
    });
  });
}
