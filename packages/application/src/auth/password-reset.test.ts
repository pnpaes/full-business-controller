import { AUTH_ERROR_GENERIC, hashPasswordResetToken, verifyPassword } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { beginPasswordReset, completePasswordReset } from "./password-reset";
import { issueSession, verifySession } from "./session";
import { FakeAuthStore, NOW, ORG, authDeps, userWithPassword } from "./test-support";
import type { AuthDeps } from "./types";

/** Captures reset tokens the way an out-of-band delivery channel would. */
function delivery(): {
  deps: AuthDeps;
  tokens: string[];
  deliveries: Array<{
    organizationId: string;
    userId: string;
    email: string | null;
    token: string;
  }>;
} {
  const tokens: string[] = [];
  const deliveries: Array<{
    organizationId: string;
    userId: string;
    email: string | null;
    token: string;
  }> = [];
  const deps = authDeps({
    deliverResetToken: async (delivery_) => {
      tokens.push(delivery_.token);
      deliveries.push(delivery_);
    },
  });
  return { deps, tokens, deliveries };
}

describe("beginPasswordReset", () => {
  it("is neutral for an unknown identifier: ok, no delivery, no stored token", async () => {
    const store = new FakeAuthStore();
    const { deps, tokens } = delivery();

    const result = await beginPasswordReset(store, deps, {
      organizationId: ORG,
      identifier: "nobody@example.test",
    });

    expect(result).toEqual({ ok: true });
    expect(Object.keys(result)).toEqual(["ok"]);
    expect(tokens).toEqual([]);
    expect(store.resetTokens.size).toBe(0);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetRequested);
  });

  it("is neutral for a disabled user and mints no token", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { status: "disabled" });
    const { deps, tokens } = delivery();

    const result = await beginPasswordReset(store, deps, {
      organizationId: ORG,
      identifier: user.email ?? "",
    });

    expect(result).toEqual({ ok: true });
    expect(tokens).toEqual([]);
    expect(store.resetTokens.size).toBe(0);
  });

  it("delivers a token for an active user and stores only its hash with the TTL expiry", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const { deps, tokens, deliveries } = delivery();

    const result = await beginPasswordReset(
      store,
      { ...deps, passwordResetTtlMinutes: 15 },
      { organizationId: ORG, identifier: user.email ?? "" },
    );

    expect(result).toEqual({ ok: true });
    expect(Object.keys(result)).toEqual(["ok"]);
    expect(tokens).toHaveLength(1);
    const token = tokens[0] ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // The delivery port gets the recipient address so the runtime can email it;
    // the token itself is passed here and nowhere else on the result.
    expect(deliveries[0]).toEqual({
      organizationId: ORG,
      userId: user.id,
      email: user.email,
      token,
    });

    const stored = [...store.resetTokens.values()][0];
    expect(stored?.userId).toBe(user.id);
    expect(stored?.tokenHash).toBe(hashPasswordResetToken(token));
    expect(stored?.tokenHash).not.toBe(token);
    expect(stored?.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60_000);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetRequested);
  });

  it("still stores a token when no delivery channel is configured (delivery is dropped)", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const result = await beginPasswordReset(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
    });

    expect(result).toEqual({ ok: true });
    expect(store.resetTokens.size).toBe(1);
  });
});

describe("completePasswordReset", () => {
  it("changes the password, consumes the token once, and audits completion", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const { deps, tokens } = delivery();
    await beginPasswordReset(store, deps, { organizationId: ORG, identifier: user.email ?? "" });
    const token = tokens[0] ?? "";

    const first = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token,
      newPassword: "new-password",
    });

    expect(first).toEqual({ ok: true });
    const updated = store.users.get(user.id);
    expect(await verifyPassword(updated?.passwordHash ?? "", "new-password")).toBe(true);
    expect(await verifyPassword(updated?.passwordHash ?? "", "old-password")).toBe(false);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.passwordResetCompleted);

    const second = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token,
      newPassword: "another-password",
    });
    expect(second).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.passwordHash).toBe(updated?.passwordHash);
  });

  it("refuses a weak new password with the generic error and no change", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const { deps, tokens } = delivery();
    const before = store.users.get(user.id)?.passwordHash;
    await beginPasswordReset(store, deps, { organizationId: ORG, identifier: user.email ?? "" });

    const result = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token: tokens[0] ?? "",
      newPassword: "short",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.passwordHash).toBe(before);
    expect(store.passwordUpdates).toEqual([]);
  });

  it("rejects a valid token presented in a different organization", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const { deps, tokens } = delivery();
    const before = store.users.get(user.id)?.passwordHash;
    await beginPasswordReset(store, deps, { organizationId: ORG, identifier: user.email ?? "" });

    const result = await completePasswordReset(store, deps, {
      organizationId: "org-2",
      token: tokens[0] ?? "",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.passwordHash).toBe(before);
  });

  it("revokes every existing session on success", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const { deps, tokens } = delivery();
    const session = await issueSession(store, deps, user, NOW);
    expect(await verifySession(store, session.token, NOW)).toBeDefined();

    await beginPasswordReset(store, deps, { organizationId: ORG, identifier: user.email ?? "" });
    const result = await completePasswordReset(store, deps, {
      organizationId: ORG,
      token: tokens[0] ?? "",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: true });
    expect(await verifySession(store, session.token, NOW)).toBeUndefined();
  });

  it("rejects an expired token with the generic error and no password change", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "old-password");
    const { deps, tokens } = delivery();
    const before = store.users.get(user.id)?.passwordHash;
    await beginPasswordReset(store, deps, { organizationId: ORG, identifier: user.email ?? "" });

    const result = await completePasswordReset(
      store,
      authDeps({ now: new Date(NOW.getTime() + 31 * 60_000) }),
      { organizationId: ORG, token: tokens[0] ?? "", newPassword: "new-password" },
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
