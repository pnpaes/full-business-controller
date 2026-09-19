import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { role, userLocationScope, userRole } from "../schema";

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

/** Every role defined for the organization (the assignable set). */
export async function listAssignableRoles(db: Database, organizationId: string): Promise<Role[]> {
  return db.select().from(role).where(eq(role.organizationId, organizationId));
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
