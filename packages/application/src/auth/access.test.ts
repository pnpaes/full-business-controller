import { AUTH_ERROR_GENERIC, DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  assignRole,
  disableUser,
  isAuthorizedFor,
  loadUserAccess,
  replaceLocationScopes,
} from "./access";
import { AUTH_AUDIT_ACTIONS } from "./actions";
import { authenticate } from "./authenticate";
import { issueSession, verifySession } from "./session";
import { FakeAuthStore, NOW, ORG, authDeps, userWithPassword } from "./test-support";

const OWNER = "role-owner";
const ADMIN = "role-admin";

describe("loadUserAccess / isAuthorizedFor", () => {
  it("loads roles and scopes and authorizes an explicit match", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    store.addRole(OWNER, "owner");
    store.addRole(ADMIN, "admin");
    await store.assignRole({ userId: user.id, roleId: OWNER, locationId: null, grantedBy: null });
    await store.assignRole({
      userId: user.id,
      roleId: OWNER,
      locationId: "loc-1",
      grantedBy: null,
    });
    await store.replaceLocationScopes(user.id, ["loc-1", "loc-2"]);

    const access = await loadUserAccess(store, user.id);

    expect(access.roles).toEqual(["owner"]);
    expect([...access.locationIds].sort()).toEqual(["loc-1", "loc-2"]);
    expect(isAuthorizedFor(access, { role: "owner" })).toBe(true);
    expect(isAuthorizedFor(access, { role: "owner", locationId: "loc-2" })).toBe(true);
  });

  it("fails closed and loudly for an empty requirement", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const access = await loadUserAccess(store, user.id);

    expect(() => isAuthorizedFor(access, {})).toThrow(DomainError);
  });

  it("denies a missing role or an out-of-scope location", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    store.addRole(OWNER, "owner");
    await store.assignRole({ userId: user.id, roleId: OWNER, locationId: null, grantedBy: null });
    await store.replaceLocationScopes(user.id, ["loc-1"]);

    const access = await loadUserAccess(store, user.id);

    expect(isAuthorizedFor(access, { role: "admin" })).toBe(false);
    expect(isAuthorizedFor(access, { role: "owner", locationId: "loc-9" })).toBe(false);
    expect(isAuthorizedFor(access, { locationId: "loc-9" })).toBe(false);
  });

  it("gives no implicit admin bypass", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    store.addRole(ADMIN, "admin");
    await store.assignRole({ userId: user.id, roleId: ADMIN, locationId: null, grantedBy: null });

    const access = await loadUserAccess(store, user.id);

    expect(access.roles).toEqual(["admin"]);
    expect(isAuthorizedFor(access, { role: "owner" })).toBe(false);
  });
});

describe("assignRole", () => {
  it("grants the role, revokes every session and audits before/after", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    store.addRole(OWNER, "owner");
    const session = await issueSession(store, authDeps(), user, NOW);
    expect(await verifySession(store, session.token, NOW)).toBeDefined();

    await assignRole(
      store,
      {
        organizationId: ORG,
        userId: user.id,
        roleId: OWNER,
        locationId: "loc-1",
        actorId: "admin-1",
      },
      NOW,
    );

    expect(await verifySession(store, session.token, NOW)).toBeUndefined();
    const entry = store.audits.find((row) => row.action === AUTH_AUDIT_ACTIONS.accessRoleChanged)!;
    expect(entry.actorId).toBe("admin-1");
    expect(entry.entityId).toBe(user.id);
    expect(entry.before).toEqual({ roles: [] });
    expect(entry.after).toEqual({
      roles: [{ roleId: OWNER, code: "owner", locationId: "loc-1" }],
    });
  });
});

describe("replaceLocationScopes", () => {
  it("replaces the scope exactly and audits before/after", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    await store.replaceLocationScopes(user.id, ["loc-1", "loc-2"]);

    await replaceLocationScopes(store, {
      organizationId: ORG,
      userId: user.id,
      locationIds: ["loc-3"],
      actorId: "admin-1",
    });

    expect((await loadUserAccess(store, user.id)).locationIds).toEqual(["loc-3"]);
    const entry = store.audits.find(
      (row) => row.action === AUTH_AUDIT_ACTIONS.accessScopesChanged,
    )!;
    expect(entry.before).toEqual({ locationIds: ["loc-1", "loc-2"] });
    expect(entry.after).toEqual({ locationIds: ["loc-3"] });
  });
});

describe("disableUser", () => {
  it("disables the user, revokes sessions and rejects later authentication", async () => {
    const store = new FakeAuthStore();
    const user = await userWithPassword(store, "correct-password");
    const session = await issueSession(store, authDeps(), user, NOW);
    expect(await verifySession(store, session.token, NOW)).toBeDefined();

    await disableUser(
      store,
      { organizationId: ORG, userId: user.id, actorId: "admin-1", reason: "offboarding" },
      NOW,
    );

    expect(store.users.get(user.id)?.status).toBe("disabled");
    expect(await verifySession(store, session.token, NOW)).toBeUndefined();

    const attempt = await authenticate(store, authDeps(), {
      organizationId: ORG,
      identifier: user.email ?? "",
      password: "correct-password",
    });
    expect(attempt).toEqual({ ok: false, error: AUTH_ERROR_GENERIC });

    const entry = store.audits.find((row) => row.action === AUTH_AUDIT_ACTIONS.userDisabled)!;
    expect(entry.reason).toBe("offboarding");
    expect(entry.after).toEqual({ status: "disabled", revokedSessions: 1 });
  });
});
