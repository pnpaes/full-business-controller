import { AUTH_ERROR_GENERIC, totpCode } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { verifyMfa } from "./mfa";
import {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
  totpEnrolmentUri,
} from "./totp-enrolment";
import {
  FakeAuthStore,
  KEY,
  NOW,
  ORG,
  authDeps,
  counterAt,
  userWithPassword,
} from "./test-support";

const deps = authDeps({ totpEncryptionKey: KEY });
const later = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

describe("beginTotpEnrolment", () => {
  it("mints a secret, stores it unconfirmed and returns the URI once", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const result = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.issuer).toBe("Aquarela Business Control");
    expect(result.account).toBe(user.username);
    expect(result.uri).toBe(totpEnrolmentUri(result.secret, result.issuer, result.account));
    expect(result.uri.startsWith("otpauth://totp/")).toBe(true);
    expect(result.uri).toContain(`secret=${result.secret}`);

    const totp = store.totps.get(user.id);
    expect(totp?.confirmedAt).toBeNull();
    expect(totp?.lastUsedCounter).toBeNull();
    expect(totp?.recoveryCodesHash).toEqual([]);
    expect(totp?.secretEncrypted).not.toContain(result.secret);
    expect(store.users.get(user.id)?.totpEnabled).toBe(false);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.mfaEnrolmentStarted);
  });

  it("fails closed and audits when the encryption key is missing", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const result = await beginTotpEnrolment(store, authDeps(), {
      organizationId: ORG,
      userId: user.id,
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.totps.size).toBe(0);
    const failed = store.audits.find(
      (entry) =>
        entry.action === AUTH_AUDIT_ACTIONS.mfaEnrolmentFailed && entry.reason === "config_missing",
    );
    expect(failed).toBeDefined();
  });

  it("clears a stale confirmation when beginning again", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    await beginTotpEnrolment(store, deps, { organizationId: ORG, userId: user.id });
    store.totps.set(user.id, {
      ...store.totps.get(user.id)!,
      confirmedAt: NOW,
      lastUsedCounter: 42,
      recoveryCodesHash: ["stale"],
    });

    const second = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });

    expect(second.ok).toBe(true);
    expect(store.totps.get(user.id)).toMatchObject({
      confirmedAt: null,
      lastUsedCounter: null,
      recoveryCodesHash: [],
    });
  });

  it("refuses to begin again while TOTP is enabled", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { totpEnabled: true });

    const result = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    const failed = store.audits.find((entry) => entry.reason === "already_enabled");
    expect(failed).toBeDefined();
  });

  it("rejects a user from another organization", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");

    const result = await beginTotpEnrolment(store, deps, {
      organizationId: "org-2",
      userId: user.id,
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.totps.size).toBe(0);
  });
});

describe("confirmTotpEnrolment", () => {
  it("cannot be used by verifyMfa until it is confirmed", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }

    const result = await verifyMfa(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(NOW)),
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.audits.some((entry) => entry.reason === "no_confirmed_totp")).toBe(true);
  });

  it("confirms with a valid RFC-6238 code and returns recovery codes once", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }

    const result = await confirmTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(NOW)),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recoveryCodes).toHaveLength(10);

    const totp = store.totps.get(user.id);
    expect(totp?.confirmedAt?.getTime()).toBe(NOW.getTime());
    expect(totp?.recoveryCodesHash).toHaveLength(10);
    // Only hashes are stored, never the plaintext codes.
    for (const code of result.recoveryCodes) {
      expect(totp?.recoveryCodesHash).not.toContain(code);
    }
    expect(store.users.get(user.id)?.totpEnabled).toBe(true);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.mfaEnrolmentConfirmed);

    // Once confirmed, a fresh second-factor code works.
    const mfa = await verifyMfa(store, authDeps({ now: later(30), totpEncryptionKey: KEY }), {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(later(30))),
    });
    expect(mfa.ok).toBe(true);
  });

  it("rejects a wrong code, leaves the enrolment unconfirmed and audits it", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }

    const result = await confirmTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: "000000",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.totps.get(user.id)?.confirmedAt).toBeNull();
    expect(store.users.get(user.id)?.totpEnabled).toBe(false);
    expect(
      store.audits.some(
        (entry) =>
          entry.action === AUTH_AUDIT_ACTIONS.mfaEnrolmentFailed && entry.reason === "invalid_code",
      ),
    ).toBe(true);
  });

  it("never writes the secret, URI or recovery codes to an audit row", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }
    const confirmed = await confirmTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(NOW)),
    });
    if (!confirmed.ok) {
      throw new Error("expected confirmation");
    }

    const dumped = JSON.stringify(store.audits);
    expect(dumped).not.toContain(begun.secret);
    expect(dumped).not.toContain(begun.uri);
    expect(dumped).not.toContain("otpauth");
    for (const code of confirmed.recoveryCodes) {
      expect(dumped).not.toContain(code);
    }
  });
});

describe("regenerateRecoveryCodes", () => {
  it("replaces the set, invalidating the old codes and requiring a fresh code", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }
    const confirmed = await confirmTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(NOW)),
    });
    if (!confirmed.ok) {
      throw new Error("expected confirmation");
    }
    const oldCode = confirmed.recoveryCodes[0] ?? "";

    const at = later(30);
    const result = await regenerateRecoveryCodes(
      store,
      authDeps({ now: at, totpEncryptionKey: KEY }),
      { organizationId: ORG, userId: user.id, token: totpCode(begun.secret, counterAt(at)) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recoveryCodes).not.toContain(oldCode);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.mfaRecoveryRegenerated);

    // The old code is now dead; a new one still authenticates.
    const verifyDeps = authDeps({ now: later(60), totpEncryptionKey: KEY });
    const oldAttempt = await verifyMfa(store, verifyDeps, {
      organizationId: ORG,
      userId: user.id,
      token: oldCode,
    });
    expect(oldAttempt).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });

    const newAttempt = await verifyMfa(store, verifyDeps, {
      organizationId: ORG,
      userId: user.id,
      token: result.recoveryCodes[0] ?? "",
    });
    expect(newAttempt.ok).toBe(true);
  });

  it("rejects a replayed TOTP code", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }
    const token = totpCode(begun.secret, counterAt(NOW));
    await confirmTotpEnrolment(store, deps, { organizationId: ORG, userId: user.id, token });

    const result = await regenerateRecoveryCodes(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token,
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.audits.some((entry) => entry.reason === "regenerate_replayed")).toBe(true);
  });
});

describe("disableTotp", () => {
  it("requires the correct password and makes verifyMfa fail afterwards", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const begun = await beginTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
    });
    if (!begun.ok) {
      throw new Error("expected enrolment to begin");
    }
    await confirmTotpEnrolment(store, deps, {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(NOW)),
    });

    // Two live sessions issued while MFA was enabled.
    const expiresAt = later(3600);
    await store.createSession({ userId: user.id, tokenHash: "hash-a", expiresAt });
    await store.createSession({ userId: user.id, tokenHash: "hash-b", expiresAt });
    const activeSessions = (): number =>
      [...store.sessions.values()].filter((session) => session.revokedAt === null).length;

    const wrong = await disableTotp(store, deps, {
      organizationId: ORG,
      userId: user.id,
      password: "wrong-password",
    });
    expect(wrong).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.users.get(user.id)?.totpEnabled).toBe(true);
    expect(store.audits.some((entry) => entry.reason === "bad_password")).toBe(true);
    // A wrong password must revoke nothing.
    expect(activeSessions()).toBe(2);

    const right = await disableTotp(store, deps, {
      organizationId: ORG,
      userId: user.id,
      password: "correct-password",
    });
    expect(right).toEqual({ ok: true });
    expect(store.users.get(user.id)?.totpEnabled).toBe(false);
    expect(store.totps.has(user.id)).toBe(false);
    // A successful disable revokes every session and records the count.
    expect(activeSessions()).toBe(0);
    expect(
      store.audits.find((entry) => entry.action === AUTH_AUDIT_ACTIONS.mfaDisabled)?.after,
    ).toEqual({ sessionsRevoked: 2 });

    const after = await verifyMfa(store, authDeps({ now: later(30), totpEncryptionKey: KEY }), {
      organizationId: ORG,
      userId: user.id,
      token: totpCode(begun.secret, counterAt(later(30))),
    });
    expect(after).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
  });

  it("fails closed for a disabled user but still pays one verification", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password", { status: "disabled" });

    const result = await disableTotp(store, deps, {
      organizationId: ORG,
      userId: user.id,
      password: "correct-password",
    });

    expect(result).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });
    expect(store.audits.some((entry) => entry.reason === "user_not_active")).toBe(true);
  });
});
