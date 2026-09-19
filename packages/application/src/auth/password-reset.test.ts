import { AUTH_ERROR_GENERIC, hashPasswordResetToken, verifyPassword } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { beginPasswordReset, completePasswordReset } from "./password-reset";
import { issueSession, verifySession } from "./session";
import { FakeAuthStore, NOW, ORG, authDeps, userWithPassword } from "./test-support";

describe("beginPasswordReset", () => {
  it("is neutral for an unknown identifier: ok, no token, no stored token", async () => {
    const store = new FakeAuthStore();

    const result = await beginPasswordReset(store, authDeps(), {
      organizationId: ORG,
      identifier: "nobody@example.test",
    });

    expect(result).toEqual({ ok: true });
    expect(result.token).toBeUndefined();
    expect(store.resetTokens.size).toBe(0);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetRequested);
  });

  it("is neutral for a disabled user and mints no token", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { status: "disabled" });

    const result = await beginPasswordReset(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
    });

    expect(result).toEqual({ ok: true });
    expect(store.resetTokens.size).toBe(0);
  });

  it("mints a token for an active user and stores only its hash with the TTL expiry", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const result = await beginPasswordReset(store, authDeps({ passwordResetTtlMinutes: 15 }), {
      organizationId: ORG,
      identifier: user.email ?? "",
    });

    expect(result.ok).toBe(true);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(store.resetTokens.size).toBe(1);
    const stored = [...store.resetTokens.values()][0]!;
    expect(stored.tokenHash).toBe(hashPasswordResetToken(result.token ?? ""));
    expect(stored.tokenHash).not.toBe(result.token);
    expect(stored.userId).toBe(user.id);
    expect(stored.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60_000);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetRequested);
  });
});

describe("completePasswordReset", () => {
  it("changes the password, consumes the token once, and audits completion", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const deps = authDeps();
    const begun = await beginPasswordReset(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
    });
    const token = begun.token ?? "";

    const first = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token,
      newPassword: "new-password",
    });

    expect(first).toEqual({ ok: true });
    const updated = store.users.get(user.id)!;
    expect(await verifyPassword(updated.passwordHash, "new-password")).toBe(true);
    expect(await verifyPassword(updated.passwordHash, "old-password")).toBe(false);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetCompleted);

    const second = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token,
      newPassword: "another-password",
    });
    expect(second).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.passwordHash).toBe(updated.passwordHash);
  });

  it("revokes every existing session on success", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const deps = authDeps();
    const session = await issueSession(store, deps, user, NOW);
    expect(await verifySession(store, session.token, NOW)).toBeDefined();

    const begun = await beginPasswordReset(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
    });
    const result = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token: begun.token ?? "",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: true });
    expect(await verifySession(store, session.token, NOW)).toBeUndefined();
  });

  it("rejects an expired token with the generic error and no password change", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const deps = authDeps();
    const begun = await beginPasswordReset(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
    });
    const before = store.users.get(user.id)?.passwordHash;

    const result = await completePasswordReset(
      store,
      authDeps({ now: new Date(NOW.getTime() + 31 * 60_000) }),
      {
        organizationId: ORG,
        token: begun.token ?? "",
        newPassword: "new-password",
      },
    );

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.passwordHash).toBe(before);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetFailed);
  });

  it("rejects an unknown token with the generic error", async () => {
    const store = new FakeAuthStore();
    const result = await completePasswordReset(store, authDeps(), {
      organizationId: ORG,
      token: "not-a-real-token",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.passwordUpdates).toEqual([]);
  });
});
