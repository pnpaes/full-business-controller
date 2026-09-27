import { AUTH_ERROR_GENERIC, verifyPassword } from "@aquarela/domain";
import { describe, expect, it, vi } from "vitest";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { authenticate } from "./authenticate";
import { INVITE_PENDING_PASSWORD_HASH, acceptInvite, inviteEmployeeUser } from "./invite";
import { FakeAuthStore, NOW, ORG, authDeps } from "./test-support";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const EMAIL = "newhire@example.test";
const PASSWORD = "correct horse battery staple";

function seed(overrides: { userId?: string | null; organizationId?: string } = {}): FakeAuthStore {
  const store = new FakeAuthStore();
  store.addEmployee({
    id: EMPLOYEE,
    organizationId: overrides.organizationId ?? ORG,
    userId: overrides.userId ?? null,
  });
  return store;
}

describe("inviteEmployeeUser", () => {
  it("creates an invited account, links the employee and mints a token", async () => {
    const store = seed();

    const result = await inviteEmployeeUser(store, authDeps(), {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });

    expect(result.employeeId).toBe(EMPLOYEE);
    expect(result.token.length).toBeGreaterThan(0);
    // The stored invite holds only the hash: the plaintext is never persisted.
    expect([...store.invites.values()].some((i) => i.tokenHash === result.token)).toBe(false);

    const user = await store.findUserById(result.userId);
    expect(user?.status).toBe("invited");
    expect(user?.email).toBe(EMAIL);
    expect(user?.username).toBe(EMAIL);
    expect(user?.passwordHash).toBe(INVITE_PENDING_PASSWORD_HASH);
    await expect(verifyPassword(user!.passwordHash, PASSWORD)).resolves.toBe(false);
    expect(store.employees.get(EMPLOYEE)?.userId).toBe(result.userId);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.userInvited);
  });

  it("an invited account cannot authenticate before acceptance", async () => {
    const store = seed();
    await inviteEmployeeUser(store, authDeps(), {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });

    const result = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: EMAIL,
      password: PASSWORD,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(AUTH_ERROR_GENERIC);
    }
  });

  it("refuses an unknown or cross-organization employee", async () => {
    const store = seed({ organizationId: "org-2" });
    await expect(
      inviteEmployeeUser(store, authDeps(), {
        organizationId: ORG,
        actorId: "actor-1",
        employeeId: EMPLOYEE,
        email: EMAIL,
      }),
    ).rejects.toThrow(/employee not found/);
  });

  it("reuses (re-invites) an already linked account that is still invited", async () => {
    const store = seed({ userId: "invited-user" });
    store.addUser({ id: "invited-user", organizationId: ORG, status: "invited" });
    const result = await inviteEmployeeUser(store, authDeps(), {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });
    expect(result.userId).toBe("invited-user");
    expect(store.employees.get(EMPLOYEE)?.userId).toBe("invited-user");
  });

  it("refuses a linked account that is not inviteable", async () => {
    const store = seed({ userId: "disabled-user" });
    store.addUser({ id: "disabled-user", organizationId: ORG, status: "disabled" });
    await expect(
      inviteEmployeeUser(store, authDeps(), {
        organizationId: ORG,
        actorId: "actor-1",
        employeeId: EMPLOYEE,
        email: EMAIL,
      }),
    ).rejects.toThrow(/not inviteable/);
  });

  it("refuses an employee whose linked account is already active", async () => {
    const store = seed({ userId: "active-user" });
    store.addUser({ id: "active-user", organizationId: ORG, status: "active" });
    await expect(
      inviteEmployeeUser(store, authDeps(), {
        organizationId: ORG,
        actorId: "actor-1",
        employeeId: EMPLOYEE,
        email: EMAIL,
      }),
    ).rejects.toThrow(/already has an active account/);
  });

  it("refuses to take over an existing active account with the same email", async () => {
    const store = seed();
    store.addUser({ organizationId: ORG, email: EMAIL, username: EMAIL, status: "active" });
    await expect(
      inviteEmployeeUser(store, authDeps(), {
        organizationId: ORG,
        actorId: "actor-1",
        employeeId: EMPLOYEE,
        email: EMAIL,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("a re-invite revokes the prior live invite", async () => {
    const store = seed();
    const deps = authDeps();
    const first = await inviteEmployeeUser(store, deps, {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });
    const second = await inviteEmployeeUser(store, deps, {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });
    expect(second.userId).toBe(first.userId);
    // The superseded token no longer redeems.
    const stale = await acceptInvite(store, deps, {
      organizationId: ORG,
      token: first.token,
      newPassword: PASSWORD,
    });
    expect(stale.ok).toBe(false);
    const fresh = await acceptInvite(store, deps, {
      organizationId: ORG,
      token: second.token,
      newPassword: PASSWORD,
    });
    expect(fresh.ok).toBe(true);
  });
});

describe("acceptInvite", () => {
  async function invite(): Promise<{ store: FakeAuthStore; token: string; userId: string }> {
    const store = seed();
    const result = await inviteEmployeeUser(store, authDeps(), {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });
    return { store, token: result.token, userId: result.userId };
  }

  it("activates the account, sets the password and issues a session", async () => {
    const { store, token, userId } = await invite();

    const result = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token,
      newPassword: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.token.length).toBeGreaterThan(0);
    }
    const user = await store.findUserById(userId);
    expect(user?.status).toBe("active");
    await expect(verifyPassword(user!.passwordHash, PASSWORD)).resolves.toBe(true);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.inviteAccepted);

    // The freshly activated employee can now log in.
    const login = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: EMAIL,
      password: PASSWORD,
    });
    expect(login.ok).toBe(true);
  });

  it("refuses a short or whitespace-only password without burning the invite", async () => {
    const { store, token, userId } = await invite();

    for (const weak of ["short", " ".repeat(12)]) {
      const result = await acceptInvite(store, authDeps(), {
        organizationId: ORG,
        token,
        newPassword: weak,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(AUTH_ERROR_GENERIC);
      }
    }

    const user = await store.findUserById(userId);
    expect(user?.status).toBe("invited");
    expect(store.passwordUpdates).toEqual([]);
    expect(store.successes).toEqual([]);

    // The refusal precedes claiming, so the still-live token accepts a stronger one.
    const retry = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token,
      newPassword: PASSWORD,
    });
    expect(retry.ok).toBe(true);
  });

  it("revokes every prior session and records the login on accept", async () => {
    const { store, token, userId } = await invite();
    const revoke = vi.spyOn(store, "revokeAllSessionsForUser");
    store.sessions.set("stray", {
      id: "stray",
      userId,
      tokenHash: "stray-session-hash",
      expiresAt: new Date(NOW.getTime() + 60_000),
      revokedAt: null,
    });

    const result = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token,
      newPassword: PASSWORD,
    });

    expect(result.ok).toBe(true);
    expect(revoke).toHaveBeenCalledWith(userId, NOW);
    expect(store.sessions.get("stray")?.revokedAt).toEqual(NOW);
    expect(store.successes).toContain(userId);
  });

  it("is single use", async () => {
    const { store, token } = await invite();
    const first = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token,
      newPassword: PASSWORD,
    });
    expect(first.ok).toBe(true);

    const second = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token,
      newPassword: "another password",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe(AUTH_ERROR_GENERIC);
    }
  });

  it("rejects an expired token", async () => {
    const { store, token } = await invite();
    const now = new Date(Date.now() + 8 * 24 * 60 * 60_000);

    const result = await acceptInvite(store, authDeps({ now }), {
      organizationId: ORG,
      token,
      newPassword: PASSWORD,
    });
    expect(result.ok).toBe(false);
    expect(store.actions()).toContain(AUTH_AUDIT_ACTIONS.inviteFailed);
  });

  it("rejects an unknown token without enumerating", async () => {
    const { store } = await invite();
    const result = await acceptInvite(store, authDeps(), {
      organizationId: ORG,
      token: "not-a-real-token",
      newPassword: PASSWORD,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(AUTH_ERROR_GENERIC);
    }
  });

  it("rejects a token from another organization", async () => {
    const { store, token } = await invite();
    const result = await acceptInvite(store, authDeps(), {
      organizationId: "org-2",
      token,
      newPassword: PASSWORD,
    });
    expect(result.ok).toBe(false);
  });

  it("revokes any other outstanding invite for the user on acceptance", async () => {
    const store = seed();
    const deps = authDeps();
    const first = await inviteEmployeeUser(store, deps, {
      organizationId: ORG,
      actorId: "actor-1",
      employeeId: EMPLOYEE,
      email: EMAIL,
    });
    // A second live invite for a *different* employee would be a different user;
    // force a stray second live invite on the same user to prove accept sweeps it.
    const stray = await store.createInvite({
      organizationId: ORG,
      userId: first.userId,
      tokenHash: "stray-hash",
      expiresAt: new Date(deps.now!.getTime() + 60_000),
      issuedBy: "actor-1",
    });
    expect(stray.id).toBeDefined();

    const accepted = await acceptInvite(store, deps, {
      organizationId: ORG,
      token: first.token,
      newPassword: PASSWORD,
    });
    expect(accepted.ok).toBe(true);
    const live = [...store.invites.values()].filter(
      (i) => i.acceptedAt === null && i.revokedAt === null,
    );
    expect(live).toHaveLength(0);
  });
});
