import { randomBytes, randomUUID } from "node:crypto";

import {
  AUTH_ERROR_GENERIC,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCodes,
  sealSecret,
  totpCode,
} from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { authenticate } from "./authenticate";
import { verifyMfa } from "./mfa";
import { logout, logoutAll, verifySession } from "./session";
import type {
  AuditInput,
  AuthSessionRecord,
  AuthStore,
  AuthTotpRecord,
  AuthUser,
  CreateSessionInput,
} from "./types";

/** Cheap Argon2 params keep the unit suite fast; the hash carries its own params. */
const CHEAP = { memoryCost: 8, timeCost: 1, parallelism: 1 };
const KEY = randomBytes(32);
const ORG = "org-1";
const NOW = new Date("2026-09-19T12:00:00.000Z");
const counterAt = (at: Date): number => Math.floor(at.getTime() / 1000 / 30);

class FakeAuthStore implements AuthStore {
  readonly users = new Map<string, AuthUser>();
  readonly totps = new Map<string, AuthTotpRecord>();
  readonly sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  readonly audits: AuditInput[] = [];
  readonly failures: Array<{ userId: string; lockedUntil: Date | null }> = [];
  readonly successes: string[] = [];
  readonly passwordUpdates: string[] = [];

  addUser(overrides: Partial<AuthUser> = {}): AuthUser {
    const id = overrides.id ?? randomUUID();
    const user: AuthUser = {
      id,
      organizationId: ORG,
      username: `user_${id.slice(0, 8)}`,
      email: `user_${id.slice(0, 8)}@example.test`,
      status: "active",
      passwordHash: "unset",
      failedLoginCount: 0,
      lockedUntil: null,
      totpEnabled: false,
      ...overrides,
    };
    this.users.set(id, user);
    return user;
  }

  actions(): string[] {
    return this.audits.map((entry) => entry.action);
  }

  async findUserById(userId: string): Promise<AuthUser | undefined> {
    return this.users.get(userId);
  }

  async findUserByIdentifier(
    organizationId: string,
    identifier: string,
  ): Promise<AuthUser | undefined> {
    const normalized = identifier.trim().toLowerCase();
    return [...this.users.values()].find(
      (user) =>
        user.organizationId === organizationId &&
        [user.username, user.email].some(
          (value) => value !== null && value.toLowerCase() === normalized,
        ),
    );
  }

  async recordLoginSuccess(userId: string): Promise<void> {
    this.successes.push(userId);
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, failedLoginCount: 0, lockedUntil: null });
    }
  }

  async recordLoginFailure(
    userId: string,
    input: { lockedUntil: Date | null; at: Date },
  ): Promise<void> {
    this.failures.push({ userId, lockedUntil: input.lockedUntil });
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, {
        ...user,
        failedLoginCount: user.failedLoginCount + 1,
        lockedUntil: input.lockedUntil,
      });
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.passwordUpdates.push(userId);
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, passwordHash });
    }
  }

  async getTotp(userId: string): Promise<AuthTotpRecord | undefined> {
    return this.totps.get(userId);
  }

  async withTransaction<T>(fn: (store: AuthStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async advanceLastUsedCounter(userId: string, counter: number): Promise<boolean> {
    const totp = this.totps.get(userId);
    if (totp === undefined || counter <= (totp.lastUsedCounter ?? -1)) {
      return false;
    }
    this.totps.set(userId, { ...totp, lastUsedCounter: counter });
    return true;
  }

  async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
    const totp = this.totps.get(userId);
    if (totp === undefined || !totp.recoveryCodesHash.includes(codeHash)) {
      return false;
    }
    this.totps.set(userId, {
      ...totp,
      recoveryCodesHash: totp.recoveryCodesHash.filter((hash) => hash !== codeHash),
    });
    return true;
  }

  async setRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void> {
    const totp = this.totps.get(userId);
    if (totp === undefined) {
      throw new Error("user has no TOTP enrolment");
    }
    this.totps.set(userId, { ...totp, recoveryCodesHash: [...hashes] });
  }

  async createSession(input: CreateSessionInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    return { id };
  }

  async findActiveSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSessionRecord | undefined> {
    const found = [...this.sessions.values()].find(
      (session) =>
        session.tokenHash === tokenHash &&
        session.revokedAt === null &&
        session.expiresAt.getTime() > now.getTime(),
    );
    if (found === undefined) {
      return undefined;
    }
    const user = this.users.get(found.userId);
    if (user === undefined || user.status !== "active") {
      return undefined;
    }
    return { id: found.id, userId: found.userId, expiresAt: found.expiresAt };
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      session.revokedAt = at;
    }
  }

  async revokeAllSessionsForUser(userId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = at;
        revoked += 1;
      }
    }
    return revoked;
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }
}

async function userWithPassword(
  store: FakeAuthStore,
  password: string,
  overrides: Partial<AuthUser> = {},
): Promise<AuthUser> {
  return store.addUser({ passwordHash: await hashPassword(password, CHEAP), ...overrides });
}

async function enrolTotp(
  store: FakeAuthStore,
  user: AuthUser,
  recoveryCodes: readonly string[] = [],
): Promise<string> {
  const secret = generateTotpSecret();
  store.totps.set(user.id, {
    secretEncrypted: sealSecret(secret, KEY),
    confirmedAt: NOW,
    recoveryCodesHash: await hashRecoveryCodes(recoveryCodes, CHEAP),
    lastUsedCounter: null,
  });
  store.users.set(user.id, { ...user, totpEnabled: true });
  return secret;
}

describe("authenticate", () => {
  it("returns the same generic error for an unknown user and a wrong password", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const unknown = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: "nobody@example.test", password: "whatever" },
    );
    const wrong = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.username ?? "", password: "wrong-password" },
    );

    expect(unknown).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(wrong).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginUnknown);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginFailed);
  });

  it("rejects a disabled user even with the right password", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { status: "disabled" });

    const result = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.email ?? "", password: "correct-password" },
    );

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginDisabled);
  });

  it("rejects a locked user even with the right password and audits the lock", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", {
      lockedUntil: new Date(NOW.getTime() + 60_000),
    });

    const result = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.email ?? "", password: "correct-password" },
    );

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginLocked);
    expect(store.successes).toHaveLength(0);
  });

  it("applies a lock once the failure threshold is reached", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { failedLoginCount: 4 });

    await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.email ?? "", password: "wrong-password" },
    );

    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]?.lockedUntil?.getTime()).toBe(NOW.getTime() + 60_000);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginLocked);
  });

  it("clears the counter, rehashes and issues a session on success", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { failedLoginCount: 2 });

    const result = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.email ?? "", password: "correct-password" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.mfaRequired).toBe(false);
    expect(result.session?.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(store.users.get(user.id)?.failedLoginCount).toBe(0);
    expect(store.passwordUpdates).toEqual([user.id]);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginSucceeded);
  });

  it("requires MFA without issuing a session when TOTP is enabled", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    await enrolTotp(store, user);

    const result = await authenticate(
      store,
      { now: NOW, sessionTtlMinutes: 60 },
      { organizationId: ORG, identifier: user.email ?? "", password: "correct-password" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.mfaRequired).toBe(true);
    expect(result.session).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginMfaRequired);
  });
});

describe("verifyMfa", () => {
  it("accepts a fresh TOTP code, advances the counter and issues a session", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const secret = await enrolTotp(store, user);
    const code = totpCode(secret, counterAt(NOW));

    const result = await verifyMfa(
      store,
      { now: NOW, sessionTtlMinutes: 60, totpEncryptionKey: KEY },
      { organizationId: ORG, userId: user.id, token: code },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(store.totps.get(user.id)?.lastUsedCounter).toBe(counterAt(NOW));
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.mfaSucceeded);
  });

  it("rejects a replayed TOTP code", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const secret = await enrolTotp(store, user);
    const code = totpCode(secret, counterAt(NOW));
    const deps = { now: NOW, sessionTtlMinutes: 60, totpEncryptionKey: KEY };

    const first = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: code,
    });
    const second = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: code,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    const failed = store.audits.find(
      (entry) => entry.action === AUTH_AUDIT_ACTIONS.mfaFailed && entry.reason === "replayed",
    );
    expect(failed).toBeDefined();
  });

  it("accepts a recovery code once and removes it from the set", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const codes = generateRecoveryCodes(3);
    await enrolTotp(store, user, codes);
    const deps = { now: NOW, sessionTtlMinutes: 60, totpEncryptionKey: KEY };

    const first = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: codes[0] ?? "",
    });
    const second = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: codes[0] ?? "",
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.totps.get(user.id)?.recoveryCodesHash).toHaveLength(2);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.mfaRecoveryUsed);
  });

  it("counts MFA failures towards the lockout and then rejects even a valid code", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const secret = await enrolTotp(store, user);
    const deps = { now: NOW, sessionTtlMinutes: 60, totpEncryptionKey: KEY };
    const wrong = "000000";
    const valid = totpCode(secret, counterAt(NOW));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await verifyMfa(store, deps, { organizationId: ORG, userId: user.id, token: wrong });
    }

    expect(store.failures).toHaveLength(5);
    expect(store.users.get(user.id)?.lockedUntil).not.toBeNull();

    const afterLock = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: valid,
    });
    expect(afterLock).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    const locked = store.audits.find(
      (entry) => entry.action === AUTH_AUDIT_ACTIONS.mfaFailed && entry.reason === "locked",
    );
    expect(locked).toBeDefined();
  });

  it("fails closed and audits when the sealed secret cannot be opened", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    await enrolTotp(store, user);
    store.totps.set(user.id, {
      ...store.totps.get(user.id)!,
      secretEncrypted: "v1.zzzz.zzzz.zzzz",
    });

    const result = await verifyMfa(
      store,
      { now: NOW, sessionTtlMinutes: 60, totpEncryptionKey: KEY },
      { organizationId: ORG, userId: user.id, token: "123456" },
    );

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    const failed = store.audits.find(
      (entry) =>
        entry.action === AUTH_AUDIT_ACTIONS.mfaFailed && entry.reason === "secret_unseal_failed",
    );
    expect(failed).toBeDefined();
  });

  it("fails closed without the encryption key", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    await enrolTotp(store, user);

    await expect(
      verifyMfa(
        store,
        { now: NOW, sessionTtlMinutes: 60 },
        { organizationId: ORG, userId: user.id, token: "123456" },
      ),
    ).rejects.toThrow("TOTP_SECRET_ENCRYPTION_KEY");
  });
});

describe("sessions", () => {
  it("resolves an issued token and rejects it after logout", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const deps = { now: NOW, sessionTtlMinutes: 60 };

    const result = await authenticate(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });
    if (!result.ok || result.session === undefined) {
      throw new Error("expected a session");
    }

    expect(await verifySession(store, result.session.token, NOW)).toBeDefined();

    await logout(
      store,
      { organizationId: ORG, sessionId: result.session.sessionId, actorId: user.id },
      NOW,
    );

    expect(await verifySession(store, result.session.token, NOW)).toBeUndefined();
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.sessionRevoked);
  });

  it("revokes every session for a user", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const deps = { now: NOW, sessionTtlMinutes: 60 };

    const first = await authenticate(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });
    const second = await authenticate(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });
    if (!first.ok || !second.ok || first.session === undefined || second.session === undefined) {
      throw new Error("expected two sessions");
    }

    const revoked = await logoutAll(
      store,
      { organizationId: ORG, userId: user.id, actorId: user.id, reason: "role_change" },
      NOW,
    );

    expect(revoked).toBe(2);
    expect(await verifySession(store, first.session.token, NOW)).toBeUndefined();
    expect(await verifySession(store, second.session.token, NOW)).toBeUndefined();
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.sessionsRevokedAll);
  });
});
