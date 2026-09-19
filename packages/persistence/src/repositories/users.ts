import { and, eq, or, sql } from "drizzle-orm";

import type { Database } from "../client";
import { appUser, APP_USER_STATUS } from "../schema";

export type User = typeof appUser.$inferSelect;
export type NewUser = typeof appUser.$inferInsert;
export type UserStatus = (typeof APP_USER_STATUS)[number];

/**
 * Looks a user up by username or email **within one organization**,
 * case-insensitively and trimmed, to match the `app_user_username_key` /
 * `app_user_email_key` partial unique indexes (`lower(btrim(...))`, scoped per
 * organization). Returns `undefined` when neither matches. Throws when a single
 * identifier resolves to more than one user in the organization — e.g. one
 * user's username equal to another user's email — so a cross-column collision
 * can never silently pick one.
 */
export async function findUserByIdentifier(
  db: Database,
  organizationId: string,
  identifier: string,
): Promise<User | undefined> {
  const normalized = identifier.trim().toLowerCase();
  const rows = await db
    .select()
    .from(appUser)
    .where(
      and(
        eq(appUser.organizationId, organizationId),
        or(
          sql`lower(btrim(${appUser.username})) = ${normalized}`,
          sql`lower(btrim(${appUser.email})) = ${normalized}`,
        ),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw new Error("identifier matches more than one user in the organization");
  }
  return rows[0];
}

export async function createUser(db: Database, input: NewUser): Promise<User> {
  const rows = await db.insert(appUser).values(input).returning();
  return rows[0]!;
}

/** Caller must append the corresponding `audit_event` row in the same transaction (ADR-0003). */
export async function updatePasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
  at = new Date(),
): Promise<User | undefined> {
  const rows = await db
    .update(appUser)
    .set({ passwordHash, passwordChangedAt: at })
    .where(eq(appUser.id, userId))
    .returning();
  return rows[0];
}

/**
 * Clears the failure counter and lock, and records the successful login time.
 * Caller must append the corresponding `audit_event` row in the same transaction (ADR-0003).
 */
export async function recordLoginSuccess(
  db: Database,
  userId: string,
  at = new Date(),
): Promise<User | undefined> {
  const rows = await db
    .update(appUser)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: at })
    .where(eq(appUser.id, userId))
    .returning();
  return rows[0];
}

export interface LoginFailure {
  /** Lock expiry computed by the caller from the new failure count, or null. */
  readonly lockedUntil: Date | null;
  readonly at?: Date;
}

/**
 * Increments `failed_login_count` and applies the caller-computed lock. The
 * increment is a SQL expression, so concurrent failures cannot lose a count.
 * A non-null `lockedUntil` must be in the future relative to `at` (or now).
 */
export async function recordLoginFailure(
  db: Database,
  userId: string,
  failure: LoginFailure,
): Promise<User | undefined> {
  const at = failure.at ?? new Date();
  if (failure.lockedUntil !== null && failure.lockedUntil <= at) {
    throw new Error("lockedUntil must be in the future");
  }
  const rows = await db
    .update(appUser)
    .set({
      failedLoginCount: sql`${appUser.failedLoginCount} + 1`,
      lockedUntil: failure.lockedUntil,
    })
    .where(eq(appUser.id, userId))
    .returning();
  return rows[0];
}

/** Caller must append the corresponding `audit_event` row in the same transaction (ADR-0003). */
export async function setUserStatus(
  db: Database,
  userId: string,
  status: UserStatus,
): Promise<User | undefined> {
  const rows = await db.update(appUser).set({ status }).where(eq(appUser.id, userId)).returning();
  return rows[0];
}
