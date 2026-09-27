import { randomBytes, randomUUID } from "node:crypto";

import { AUTH_ERROR_GENERIC, hashPassword, totpCode } from "@aquarela/domain";
import {
  createDb,
  createUser,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyMfa } from "./mfa";
import { createPostgresAuthStore } from "./postgres-store";
import {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
} from "./totp-enrolment";
import type { AuthDeps } from "./types";

const databaseUrl = process.env.DATABASE_URL;
const CHEAP = { memoryCost: 8, timeCost: 1, parallelism: 1 };
const KEY = randomBytes(32);
const unique = (): string => randomUUID().replace(/-/g, "").slice(0, 12);
const counterAt = (at: Date): number => Math.floor(at.getTime() / 1000 / 30);

class RollbackSignal extends Error {}

async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

describe.skipIf(!databaseUrl)("TOTP enrolment against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let userId: string;
  const suffix = unique();

  const deps = (now: Date, key: Uint8Array | null = KEY): AuthDeps => ({
    now,
    sessionTtlMinutes: 60,
    passwordResetTtlMinutes: 30,
    inviteTtlMinutes: 7 * 24 * 60,
    passwordHashOptions: CHEAP,
    ...(key !== null ? { totpEncryptionKey: key } : {}),
  });

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`TOTP IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;

    const created = await createUser(client.db, {
      organizationId: orgId,
      username: `totp_${suffix}`,
      email: `totp_${suffix}@example.test`,
      displayName: "TOTP Integration User",
      passwordHash: await hashPassword("correct-password", CHEAP),
    });
    userId = created.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from app_user where organization_id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("enrols, confirms, regenerates and disables through the real store", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();

      const begun = await beginTotpEnrolment(store, deps(now), { organizationId: orgId, userId });
      expect(begun.ok).toBe(true);
      if (!begun.ok) {
        return;
      }

      // Unconfirmed enrolment is not a usable second factor.
      const tooEarly = await verifyMfa(store, deps(now), {
        organizationId: orgId,
        userId,
        token: totpCode(begun.secret, counterAt(now)),
      });
      expect(tooEarly).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });

      const confirmed = await confirmTotpEnrolment(store, deps(now), {
        organizationId: orgId,
        userId,
        token: totpCode(begun.secret, counterAt(now)),
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) {
        return;
      }

      const enrolled = await store.getTotp(userId);
      expect(enrolled?.confirmedAt).not.toBeNull();
      expect(enrolled?.recoveryCodesHash).toHaveLength(confirmed.recoveryCodes.length);
      expect((await store.findUserById(userId))?.totpEnabled).toBe(true);

      // A fresh second-factor code now authenticates and issues a session.
      const at = new Date(now.getTime() + 30_000);
      const mfa = await verifyMfa(store, deps(at), {
        organizationId: orgId,
        userId,
        token: totpCode(begun.secret, counterAt(at)),
      });
      expect(mfa.ok).toBe(true);

      // Regeneration needs its own fresh window: the counter consumed by the
      // verification above is a replay for a second use of the same code.
      const next = new Date(now.getTime() + 60_000);
      const regenerated = await regenerateRecoveryCodes(store, deps(next), {
        organizationId: orgId,
        userId,
        token: totpCode(begun.secret, counterAt(next)),
      });
      expect(regenerated.ok).toBe(true);

      // Two sessions issued while MFA was enabled.
      const sessionA = randomBytes(32).toString("hex");
      const sessionB = randomBytes(32).toString("hex");
      const sessionExpiry = new Date(next.getTime() + 3_600_000);
      await store.createSession({ userId, tokenHash: sessionA, expiresAt: sessionExpiry });
      await store.createSession({ userId, tokenHash: sessionB, expiresAt: sessionExpiry });

      // Wrong password: generic error, MFA still on, both sessions still live.
      const wrong = await disableTotp(store, deps(next), {
        organizationId: orgId,
        userId,
        password: "wrong-password",
      });
      expect(wrong).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
      expect((await store.findUserById(userId))?.totpEnabled).toBe(true);
      expect(await store.findActiveSessionByTokenHash(sessionA, next)).toBeDefined();
      expect(await store.findActiveSessionByTokenHash(sessionB, next)).toBeDefined();

      const disabled = await disableTotp(store, deps(next), {
        organizationId: orgId,
        userId,
        password: "correct-password",
      });
      expect(disabled).toEqual({ ok: true });
      expect(await store.getTotp(userId)).toBeUndefined();
      expect((await store.findUserById(userId))?.totpEnabled).toBe(false);
      // The correct password revokes every session atomically with the disable.
      expect(await store.findActiveSessionByTokenHash(sessionA, next)).toBeUndefined();
      expect(await store.findActiveSessionByTokenHash(sessionB, next)).toBeUndefined();
    });
  });

  it("returns the generic error and stores nothing without an encryption key", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();

      const result = await beginTotpEnrolment(store, deps(now, null), {
        organizationId: orgId,
        userId,
      });

      expect(result.ok).toBe(false);
      expect(await store.getTotp(userId)).toBeUndefined();
    });
  });

  it("rejects a wrong confirmation code and leaves the row unconfirmed", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();
      await beginTotpEnrolment(store, deps(now), { organizationId: orgId, userId });

      const result = await confirmTotpEnrolment(store, deps(now), {
        organizationId: orgId,
        userId,
        token: "000000",
      });

      expect(result.ok).toBe(false);
      expect((await store.getTotp(userId))?.confirmedAt).toBeNull();
      expect((await store.findUserById(userId))?.totpEnabled).toBe(false);
    });
  });
});
