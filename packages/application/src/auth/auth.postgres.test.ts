import { randomUUID } from "node:crypto";

import {
  hashInviteToken,
  hashPassword,
  hashPasswordResetToken,
  verifyPassword,
} from "@aquarela/domain";
import {
  createDb,
  createEmployee,
  createUser,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignRole, loadUserAccess, replaceLocationScopes } from "./access";
import { INVITE_PENDING_PASSWORD_HASH, acceptInvite, inviteEmployeeUser } from "./invite";
import { beginPasswordReset, completePasswordReset } from "./password-reset";
import { createPostgresAuthStore } from "./postgres-store";
import { issueSession, verifySession } from "./session";
import type { AuthDeps, AuthUser } from "./types";

const databaseUrl = process.env.DATABASE_URL;
const CHEAP = { memoryCost: 8, timeCost: 1, parallelism: 1 };
const unique = (): string => randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and rolls it back, so no rows leak. */
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

describe.skipIf(!databaseUrl)("auth commands against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let userId: string;
  let user: AuthUser;
  let roleId: string;
  let locationId: string;
  const suffix = unique();

  const deps = (now: Date): AuthDeps => ({
    now,
    sessionTtlMinutes: 60,
    passwordResetTtlMinutes: 30,
    inviteTtlMinutes: 7 * 24 * 60,
    passwordHashOptions: CHEAP,
  });

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Auth IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;

    const created = await createUser(client.db, {
      organizationId: orgId,
      username: `it_${suffix}`,
      email: `it_${suffix}@example.test`,
      displayName: "Integration User",
      passwordHash: await hashPassword("old-password", CHEAP),
    });
    user = created;
    userId = created.id;

    const role = await client.pool.query<{ id: string }>(
      "insert into role (organization_id, code, name) values ($1, $2, $3) returning id",
      [orgId, "owner", "Owner"],
    );
    roleId = role.rows[0]!.id;

    // `DEC-151`: the employee fixtures below name `role_code = 'kitchen'`, so the
    // role row must exist for this organization before the employee insert.
    await client.pool.query("insert into role (organization_id, code, name) values ($1, $2, $3)", [
      orgId,
      "kitchen",
      "Kitchen",
    ]);

    const location = await client.pool.query<{ id: string }>(
      "insert into location (organization_id, code, name) values ($1, $2, $3) returning id",
      [orgId, `loc_${suffix}`, "Test Location"],
    );
    locationId = location.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from app_user where organization_id = $1", [orgId]);
      await client.pool.query("delete from role where organization_id = $1", [orgId]);
      await client.pool.query("delete from location where organization_id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("completes a password reset, consumes the token and revokes sessions", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();
      const session = await issueSession(store, deps(now), user, now);
      expect(await verifySession(store, session.token, now)).toBeDefined();

      const delivered: string[] = [];
      const begun = await beginPasswordReset(
        store,
        {
          ...deps(now),
          deliverResetToken: async ({ token }) => {
            delivered.push(token);
          },
        },
        { organizationId: orgId, identifier: user.email ?? "" },
      );
      expect(begun.ok).toBe(true);
      const token = delivered[0] ?? "";
      expect(token.length).toBeGreaterThan(0);

      const result = await completePasswordReset(store, deps(now), {
        organizationId: orgId,
        token,
        newPassword: "new-password",
      });
      expect(result).toEqual({ ok: true });

      const updated = await store.findUserById(userId);
      expect(await verifyPassword(updated!.passwordHash, "new-password")).toBe(true);
      expect(await verifySession(store, session.token, now)).toBeUndefined();
      expect(
        await store.findActiveResetTokenByHash(hashPasswordResetToken(token), now),
      ).toBeUndefined();
    });
  });

  it("round-trips a role grant and location scopes through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);

      await assignRole(store, { organizationId: orgId, userId, roleId, actorId: null });
      await replaceLocationScopes(store, {
        organizationId: orgId,
        userId,
        locationIds: [locationId],
        actorId: null,
      });

      const access = await loadUserAccess(store, userId);
      expect(access.roles).toContain("owner");
      expect(access.locationIds).toContain(locationId);
    });
  });

  it("reads the audit register organization-scoped through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      await store.writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "login_success",
        entityType: "app_user",
        entityId: userId,
      });
      await store.writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "role_granted",
        entityType: "app_user",
        entityId: userId,
      });

      const rows = await store.listAuditEvents({ organizationId: orgId, entityType: "app_user" });
      expect(rows.map((row) => row.action).sort()).toEqual(["login_success", "role_granted"]);
      expect(rows.every((row) => row.organizationId === orgId)).toBe(true);

      const filtered = await store.listAuditEvents({
        organizationId: orgId,
        action: "role_granted",
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.action).toBe("role_granted");

      expect(await store.listAuditEvents({ organizationId: randomUUID() })).toEqual([]);
    });
  });

  it("lists organization users with roles and scopes, and the role catalogue, through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      await assignRole(store, { organizationId: orgId, userId, roleId, actorId: null });
      await replaceLocationScopes(store, {
        organizationId: orgId,
        userId,
        locationIds: [locationId],
        actorId: null,
      });

      const users = await store.listUsers({ organizationId: orgId, limit: 50, offset: 0 });
      const found = users.find((row) => row.id === userId);
      expect(found).toBeDefined();
      expect(found!.roles.map((row) => row.code)).toContain("owner");
      expect(found!.locationIds).toContain(locationId);
      expect(found).not.toHaveProperty("passwordHash");

      const roles = await store.listRoles(orgId);
      expect(roles.map((row) => row.code)).toContain("owner");
      expect(await store.listRoles(randomUUID())).toEqual([]);

      // The read is organization-scoped: another tenant sees nothing.
      expect(await store.listUsers({ organizationId: randomUUID(), limit: 50, offset: 0 })).toEqual(
        [],
      );
    });
  });

  it("provisions an invited employee, links the login and activates it on accept", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();
      const employee = await createEmployee(tx, {
        organizationId: orgId,
        name: "Invited Employee",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        activeFrom: "2026-01-01",
      });

      const invited = await inviteEmployeeUser(store, deps(now), {
        organizationId: orgId,
        actorId: userId,
        employeeId: employee.id,
        email: `invite_${suffix}@example.test`,
      });
      expect(invited.employeeId).toBe(employee.id);

      // Invited account: no usable password, employee linked, token stored hashed.
      const invitedUser = await store.findUserById(invited.userId);
      expect(invitedUser?.status).toBe("invited");
      expect(invitedUser?.passwordHash).toBe(INVITE_PENDING_PASSWORD_HASH);
      const linked = await store.findEmployeeLink({
        organizationId: orgId,
        employeeId: employee.id,
      });
      expect(linked?.userId).toBe(invited.userId);
      expect(await store.findActiveInviteByHash(hashInviteToken(invited.token), now)).toBeDefined();

      const accepted = await acceptInvite(store, deps(now), {
        organizationId: orgId,
        token: invited.token,
        newPassword: "brand-new-password",
      });
      expect(accepted.ok).toBe(true);

      const active = await store.findUserById(invited.userId);
      expect(active?.status).toBe("active");
      expect(await verifyPassword(active!.passwordHash, "brand-new-password")).toBe(true);
      // Single use: the token no longer resolves and a second accept fails.
      expect(
        await store.findActiveInviteByHash(hashInviteToken(invited.token), now),
      ).toBeUndefined();
      const replay = await acceptInvite(store, deps(now), {
        organizationId: orgId,
        token: invited.token,
        newPassword: "another-password",
      });
      expect(replay.ok).toBe(false);
    });
  });

  it("refuses a weak password at invite acceptance without consuming the token", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const now = new Date();
      const employee = await createEmployee(tx, {
        organizationId: orgId,
        name: "Weak Password Employee",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        activeFrom: "2026-01-01",
      });
      const invited = await inviteEmployeeUser(store, deps(now), {
        organizationId: orgId,
        actorId: userId,
        employeeId: employee.id,
        email: `weak_${suffix}@example.test`,
      });

      const refused = await acceptInvite(store, deps(now), {
        organizationId: orgId,
        token: invited.token,
        newPassword: "short",
      });
      expect(refused.ok).toBe(false);

      // Rejected before claiming: the invited account is untouched and the token
      // still redeems a policy-compliant password.
      expect((await store.findUserById(invited.userId))?.status).toBe("invited");
      expect(await store.findActiveInviteByHash(hashInviteToken(invited.token), now)).toBeDefined();

      const accepted = await acceptInvite(store, deps(now), {
        organizationId: orgId,
        token: invited.token,
        newPassword: "brand-new-password",
      });
      expect(accepted.ok).toBe(true);
    });
  });

  it("blocks linking an employee to a login in another organization (0077 guard)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAuthStore(tx);
      const employee = await createEmployee(tx, {
        organizationId: orgId,
        name: "Guarded Employee",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        activeFrom: "2026-01-01",
      });
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `Auth IT other ${suffix}` })
        .returning();
      const foreignUser = await createUser(tx, {
        organizationId: otherOrg[0]!.id,
        username: `foreign_${suffix}`,
        email: `foreign_${suffix}@example.test`,
        displayName: "Foreign User",
        passwordHash: INVITE_PENDING_PASSWORD_HASH,
        status: "invited",
      });

      let code: string | undefined;
      try {
        await store.linkEmployeeToUser({
          organizationId: orgId,
          employeeId: employee.id,
          userId: foreignUser.id,
          actorId: null,
        });
      } catch (error) {
        code =
          (error as { cause?: { code?: string }; code?: string }).cause?.code ??
          (error as { code?: string }).code;
      }
      expect(code).toBe("23514");
    });
  });
});
