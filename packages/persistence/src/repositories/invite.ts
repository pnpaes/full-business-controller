import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { userInvite } from "../schema";

export type UserInvite = typeof userInvite.$inferSelect;
export type NewUserInvite = typeof userInvite.$inferInsert;

/*
 * `DEC-146` (`WF-003`): the employee account-invite repository.
 *
 * Callers pass the *hash* of the opaque invite token (`hashInviteToken`); the
 * plaintext is delivered out of band and never stored. A live invite is one that
 * is neither accepted (`accepted_at`) nor revoked (`revoked_at`) and has not
 * passed `expires_at`; the partial unique index `user_invite_live_user_key`
 * allows at most one live invite per user, so a re-invite revokes the prior row
 * first.
 */

/** Persists one invite token (the hash only). */
export async function createInvite(db: Database, input: NewUserInvite): Promise<UserInvite> {
  const rows = await db.insert(userInvite).values(input).returning();
  return rows[0]!;
}

/** One live invite by token hash, or `undefined`. */
export async function findActiveInviteByHash(
  db: Database,
  tokenHash: string,
  now = new Date(),
): Promise<UserInvite | undefined> {
  const rows = await db
    .select()
    .from(userInvite)
    .where(
      and(
        eq(userInvite.tokenHash, tokenHash),
        isNull(userInvite.acceptedAt),
        isNull(userInvite.revokedAt),
        gt(userInvite.expiresAt, now),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Single-use claim: the update only matches an invite that is still live *and*
 * unexpired, so a concurrent second redemption or a caller that skipped the
 * active-invite lookup both get `undefined` instead of succeeding.
 */
export async function consumeInvite(
  db: Database,
  inviteId: string,
  at = new Date(),
): Promise<UserInvite | undefined> {
  const rows = await db
    .update(userInvite)
    .set({ acceptedAt: at })
    .where(
      and(
        eq(userInvite.id, inviteId),
        isNull(userInvite.acceptedAt),
        isNull(userInvite.revokedAt),
        gt(userInvite.expiresAt, at),
      ),
    )
    .returning();
  return rows[0];
}

/** Revokes every live invite for a user and returns how many were revoked. */
export async function revokeLiveInvitesForUser(
  db: Database,
  userId: string,
  at = new Date(),
): Promise<number> {
  const rows = await db
    .update(userInvite)
    .set({ revokedAt: at })
    .where(
      and(
        eq(userInvite.userId, userId),
        isNull(userInvite.acceptedAt),
        isNull(userInvite.revokedAt),
      ),
    )
    .returning();
  return rows.length;
}
