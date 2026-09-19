import { eq, sql } from "drizzle-orm";

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
 * Advances the replay counter monotonically: `greatest(current, counter)` means
 * a slower concurrent verification can never move it backwards. A negative
 * counter is a caller bug and throws; if no enrolment row matches, the update
 * changed nothing and throws rather than silently returning `undefined`.
 */
export async function setLastUsedCounter(
  db: Database,
  userId: string,
  counter: number,
): Promise<UserTotp> {
  if (counter < 0) {
    throw new Error("counter must be non-negative");
  }
  const rows = await db
    .update(userTotp)
    .set({
      lastUsedCounter: sql`greatest(coalesce(${userTotp.lastUsedCounter}, -1), ${counter})`,
    })
    .where(eq(userTotp.userId, userId))
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("user has no TOTP enrolment");
  }
  return row;
}
