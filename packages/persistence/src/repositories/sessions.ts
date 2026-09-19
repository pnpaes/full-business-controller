import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { appUser, authSession } from "../schema";

export type AuthSession = typeof authSession.$inferSelect;
export type NewAuthSession = typeof authSession.$inferInsert;

/**
 * Persists a session. Callers pass the *hash* of the opaque token
 * (`hashSessionToken`); the plaintext token is returned to the client and never
 * stored.
 */
export async function createSession(db: Database, input: NewAuthSession): Promise<AuthSession> {
  const rows = await db.insert(authSession).values(input).returning();
  return rows[0]!;
}

/**
 * Finds a live session by token hash. A session authenticates only when it is
 * not revoked, not expired, **and its user is still `active`** (ADR-0003).
 * Off-boarding and role changes must set the user status (and revoke) in the
 * same transaction as the change, so a session created concurrently with
 * `revokeAllSessionsForUser` still fails validation here.
 */
export async function findActiveSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now = new Date(),
): Promise<AuthSession | undefined> {
  const rows = await db
    .select({ session: authSession })
    .from(authSession)
    .innerJoin(appUser, eq(appUser.id, authSession.userId))
    .where(
      and(
        eq(authSession.tokenHash, tokenHash),
        isNull(authSession.revokedAt),
        gt(authSession.expiresAt, now),
        eq(appUser.status, "active"),
      ),
    )
    .limit(1);
  return rows[0]?.session;
}

/** Revokes one session; an already-revoked session is left untouched. */
export async function revokeSession(
  db: Database,
  sessionId: string,
  at = new Date(),
): Promise<AuthSession | undefined> {
  const rows = await db
    .update(authSession)
    .set({ revokedAt: at })
    .where(and(eq(authSession.id, sessionId), isNull(authSession.revokedAt)))
    .returning();
  return rows[0];
}

/**
 * Revokes every active session for a user (logout-all, role change, off-boarding).
 * Caller must append the corresponding `audit_event` row in the same transaction (ADR-0003).
 */
export async function revokeAllSessionsForUser(
  db: Database,
  userId: string,
  at = new Date(),
): Promise<number> {
  const rows = await db
    .update(authSession)
    .set({ revokedAt: at })
    .where(and(eq(authSession.userId, userId), isNull(authSession.revokedAt)))
    .returning({ id: authSession.id });
  return rows.length;
}
