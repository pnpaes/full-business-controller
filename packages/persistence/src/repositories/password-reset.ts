import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { passwordResetToken } from "../schema";

export type PasswordResetToken = typeof passwordResetToken.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetToken.$inferInsert;

/**
 * Persists a reset token. Callers pass the *hash* of the opaque token
 * (`hashPasswordResetToken`); the plaintext token is delivered out of band and
 * never stored.
 */
export async function createResetToken(
  db: Database,
  input: NewPasswordResetToken,
): Promise<PasswordResetToken> {
  const rows = await db.insert(passwordResetToken).values(input).returning();
  return rows[0]!;
}

export async function findActiveResetTokenByHash(
  db: Database,
  tokenHash: string,
  now = new Date(),
): Promise<PasswordResetToken | undefined> {
  const rows = await db
    .select()
    .from(passwordResetToken)
    .where(
      and(
        eq(passwordResetToken.tokenHash, tokenHash),
        isNull(passwordResetToken.usedAt),
        gt(passwordResetToken.expiresAt, now),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Single-use consumption: the update only matches a token that is still unused
 * *and* unexpired, so a concurrent second redemption or a caller that skipped
 * the active-token lookup both get `undefined` instead of succeeding.
 */
export async function consumeResetToken(
  db: Database,
  tokenId: string,
  at = new Date(),
): Promise<PasswordResetToken | undefined> {
  const rows = await db
    .update(passwordResetToken)
    .set({ usedAt: at })
    .where(
      and(
        eq(passwordResetToken.id, tokenId),
        isNull(passwordResetToken.usedAt),
        gt(passwordResetToken.expiresAt, at),
      ),
    )
    .returning();
  return rows[0];
}
