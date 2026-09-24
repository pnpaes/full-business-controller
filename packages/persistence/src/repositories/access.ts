import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { appUser, role, userLocationScope, userRole } from "../schema";
import type { UserStatus } from "../schema";

export type Role = typeof role.$inferSelect;

export interface UserRoleAssignment {
  readonly roleId: string;
  readonly code: string;
  readonly locationId: string | null;
}

export interface GrantedRole {
  readonly roleId: string;
  readonly locationId: string | null;
  readonly grantedAt: Date;
}

export interface AssignRoleInput {
  readonly userId: string;
  readonly roleId: string;
  /** `null` grants the role organization-wide. */
  readonly locationId: string | null;
  readonly grantedBy: string | null;
}

export interface RemoveRoleInput {
  readonly userId: string;
  readonly roleId: string;
  readonly locationId: string | null;
}

/** Roles held by a user, joined to their codes (org-wide and per-location). */
export async function listUserRoles(db: Database, userId: string): Promise<UserRoleAssignment[]> {
  return db
    .select({ roleId: userRole.roleId, code: role.code, locationId: userRole.locationId })
    .from(userRole)
    .innerJoin(role, eq(role.id, userRole.roleId))
    .where(eq(userRole.userId, userId));
}

/** Location ids the user explicitly has access to. */
export async function listUserLocationScopes(
  db: Database,
  userId: string,
): Promise<Array<{ locationId: string }>> {
  return db
    .select({ locationId: userLocationScope.locationId })
    .from(userLocationScope)
    .where(eq(userLocationScope.userId, userId));
}

/** Every role defined for the organization (the assignable set), ordered by code. */
export async function listAssignableRoles(db: Database, organizationId: string): Promise<Role[]> {
  return db
    .select()
    .from(role)
    .where(eq(role.organizationId, organizationId))
    .orderBy(asc(role.code), asc(role.id));
}

export interface OrganizationUserSummary {
  readonly id: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly totpEnabled: boolean;
  readonly lastLoginAt: Date | null;
  readonly roles: readonly UserRoleAssignment[];
  readonly locationIds: readonly string[];
}

export interface OrganizationUserListQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * One page of the organization's users, each with their role grants and location
 * scopes. The page is read first (ordered by display name, then id) and the
 * roles/scopes are then fetched for exactly those user ids, so the whole read is
 * three bounded queries regardless of page size. Only identity, status and
 * access are selected: `password_hash`, TOTP secrets and recovery codes are
 * never touched.
 */
export async function listOrganizationUsers(
  db: Database,
  query: OrganizationUserListQuery,
): Promise<OrganizationUserSummary[]> {
  const users = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      email: appUser.email,
      displayName: appUser.displayName,
      status: appUser.status,
      totpEnabled: appUser.totpEnabled,
      lastLoginAt: appUser.lastLoginAt,
    })
    .from(appUser)
    .where(eq(appUser.organizationId, query.organizationId))
    .orderBy(asc(appUser.displayName), asc(appUser.id))
    .limit(query.limit)
    .offset(query.offset);
  if (users.length === 0) {
    return [];
  }

  const userIds = users.map((user) => user.id);
  const [roleRows, scopeRows] = await Promise.all([
    db
      .select({
        userId: userRole.userId,
        roleId: userRole.roleId,
        code: role.code,
        locationId: userRole.locationId,
      })
      .from(userRole)
      .innerJoin(role, eq(role.id, userRole.roleId))
      .where(inArray(userRole.userId, userIds)),
    db
      .select({ userId: userLocationScope.userId, locationId: userLocationScope.locationId })
      .from(userLocationScope)
      .where(inArray(userLocationScope.userId, userIds)),
  ]);

  const rolesByUser = new Map<string, UserRoleAssignment[]>();
  for (const row of roleRows) {
    const list = rolesByUser.get(row.userId) ?? [];
    list.push({ roleId: row.roleId, code: row.code, locationId: row.locationId });
    rolesByUser.set(row.userId, list);
  }
  const scopesByUser = new Map<string, string[]>();
  for (const row of scopeRows) {
    const list = scopesByUser.get(row.userId) ?? [];
    list.push(row.locationId);
    scopesByUser.set(row.userId, list);
  }

  return users.map((user) => ({
    ...user,
    roles: rolesByUser.get(user.id) ?? [],
    locationIds: scopesByUser.get(user.id) ?? [],
  }));
}

/**
 * Grants a role to a user, idempotently: the `(user_id, role_id, location_id)`
 * unique constraint is `NULLS NOT DISTINCT`, so an org-wide grant (`location_id
 * null`) conflicts just like a scoped one and a repeated call refreshes
 * `granted_by`/`granted_at` instead of inserting a duplicate.
 */
export async function assignRole(db: Database, input: AssignRoleInput): Promise<GrantedRole> {
  const rows = await db
    .insert(userRole)
    .values({
      userId: input.userId,
      roleId: input.roleId,
      locationId: input.locationId,
      grantedBy: input.grantedBy,
    })
    .onConflictDoUpdate({
      target: [userRole.userId, userRole.roleId, userRole.locationId],
      set: { grantedBy: input.grantedBy, grantedAt: new Date() },
    })
    .returning({
      roleId: userRole.roleId,
      locationId: userRole.locationId,
      grantedAt: userRole.grantedAt,
    });
  return rows[0]!;
}

/**
 * Removes one role grant. Returns the removed row, or `undefined` when the
 * grant did not exist (a no-op).
 */
export async function removeRole(
  db: Database,
  input: RemoveRoleInput,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .delete(userRole)
    .where(
      and(
        eq(userRole.userId, input.userId),
        eq(userRole.roleId, input.roleId),
        input.locationId === null
          ? isNull(userRole.locationId)
          : eq(userRole.locationId, input.locationId),
      ),
    )
    .returning({ id: userRole.id });
  return rows[0];
}

/**
 * Replaces the user's whole location scope with `locationIds`. Delete-then-insert,
 * so it must run inside a caller-owned transaction (`AuthStore.withTransaction`)
 * to avoid a window with no scopes; `inRollback` tests exercise that.
 */
export async function replaceLocationScopes(
  db: Database,
  userId: string,
  locationIds: readonly string[],
): Promise<void> {
  await db.delete(userLocationScope).where(eq(userLocationScope.userId, userId));
  const unique = [...new Set(locationIds)];
  if (unique.length > 0) {
    await db.insert(userLocationScope).values(unique.map((locationId) => ({ userId, locationId })));
  }
}
