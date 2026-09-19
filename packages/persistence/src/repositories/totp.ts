import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../client";
import { userTotp } from "../schema";

export type UserTotp = typeof userTotp.$inferSelect;

export async function getTotp(db: Database, userId: string): Promise<UserTotp | undefined> {
  const rows = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  return rows[0];
}

/**
 * Creates or replaces the sealed TOTP secret for a user. The secret is sealed by
 * the caller (`sealSecret`); this module never sees or stores plaintext.
 */
export async function upsertTotpSecret(
  db: Database,
  userId: string,
  secretEncrypted: string,
): Promise<UserTotp> {
  const rows = await db
    .insert(userTotp)
    .values({ userId, secretEncrypted })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secretEncrypted } })
    .returning();
  return rows[0]!;
}

export async function confirmTotp(
  db: Database,
  userId: string,
  at = new Date(),
): Promise<UserTotp | undefined> {
  const rows = await db
    .update(userTotp)
    .set({ confirmedAt: at })
    .where(eq(userTotp.userId, userId))
    .returning();
  return rows[0];
}

/** Replaces the hashed recovery codes (`hashRecoveryCodes`) for a user. */
export async function setRecoveryCodes(
  db: Database,
  userId: string,
  codeHashes: readonly string[],
): Promise<UserTotp | undefined> {
  const rows = await db
    .update(userTotp)
    .set({ recoveryCodesHash: [...codeHashes] })
    .where(eq(userTotp.userId, userId))
    .returning();
  return rows[0];
}

/**
 * Atomically advances the replay counter, but only when `counter` is strictly
 * greater than what is stored. This is a compare-and-set rather than a
 * read-then-write, so two concurrent verifications of the same TOTP code cannot
 * both win: the loser matches zero rows and gets `undefined`, which the caller
 * treats as a replay. Returns `undefined` when the counter did not advance or
 * the user has no `user_totp` row. A negative counter is a caller bug and throws.
 */
export async function advanceLastUsedCounter(
  db: Database,
  userId: string,
  counter: number,
): Promise<UserTotp | undefined> {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error("counter must be a non-negative integer");
  }

  const rows = await db
    .update(userTotp)
    .set({ lastUsedCounter: counter })
    .where(
      and(
        eq(userTotp.userId, userId),
        sql`(${userTotp.lastUsedCounter} is null or ${userTotp.lastUsedCounter} < ${counter})`,
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Atomically consumes one recovery-code hash. The `= any(...)` guard makes
 * single use hold under concurrency: the second racing request matches zero rows
 * and gets `undefined`. Returns the updated row, or `undefined` when the hash was
 * absent (already consumed) or the user has no `user_totp` row.
 */
export async function consumeRecoveryCodeHash(
  db: Database,
  userId: string,
  codeHash: string,
): Promise<UserTotp | undefined> {
  const rows = await db
    .update(userTotp)
    .set({ recoveryCodesHash: sql`array_remove(${userTotp.recoveryCodesHash}, ${codeHash})` })
    .where(and(eq(userTotp.userId, userId), sql`${codeHash} = any(${userTotp.recoveryCodesHash})`))
    .returning();
  return rows[0];
}
