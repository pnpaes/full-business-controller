import { AUTH_ERROR_GENERIC, generateRecoveryCodes, totpCode } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { authenticate } from "./authenticate";
import { verifyMfa } from "./mfa";
import { logout, logoutAll, verifySession } from "./session";
import {
  FakeAuthStore,
  KEY,
  NOW,
  ORG,
  authDeps,
  counterAt,
  enrolTotp,
  userWithPassword,
} from "./test-support";

describe("authenticate", () => {
  it("returns the same generic error for an unknown user and a wrong password", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const unknown = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: "nobody@example.test",
      password: "whatever",
    });
    const wrong = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.username ?? "",
      password: "wrong-password",
    });

    expect(unknown).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(wrong).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginUnknown);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginFailed);
  });

  it("rejects a disabled user even with the right password", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { status: "disabled" });

    const result = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginDisabled);
  });

  it("rejects a locked user even with the right password and audits the lock", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", {
      lockedUntil: new Date(NOW.getTime() + 60_000),
    });

    const result = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginLocked);
    expect(store.successes).toHaveLength(0);
  });

  it("applies a lock once the failure threshold is reached", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { failedLoginCount: 4 });

    await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "wrong-password",
    });

    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]?.lockedUntil?.getTime()).toBe(NOW.getTime() + 60_000);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.loginLocked);
  });

  it("clears the counter, rehashes and issues a session on success", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { failedLoginCount: 2 });

    const result = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });

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

    const result = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });

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

    const result = await verifyMfa(store, authDeps({ totpEncryptionKey: KEY }), {
      organizationId: ORG,
      userId: user.id,
      token: code,
    });

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
    const deps = authDeps({ totpEncryptionKey: KEY });

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
    const deps = authDeps({ totpEncryptionKey: KEY });

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
    const deps = authDeps({ totpEncryptionKey: KEY });
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

    const result = await verifyMfa(store, authDeps({ totpEncryptionKey: KEY }), {
      organizationId: ORG,
      userId: user.id,
      token: "123456",
    });

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
      verifyMfa(store, authDeps(), { organizationId: ORG, userId: user.id, token: "123456" }),
    ).rejects.toThrow("TOTP_SECRET_ENCRYPTION_KEY");
  });
});

describe("sessions", () => {
  it("resolves an issued token and rejects it after logout", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const deps = authDeps();

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
    const deps = authDeps();

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
