import { randomUUID } from "node:crypto";

import { hashPassword, hashPasswordResetToken, verifyPassword } from "@aquarela/domain";
import {
  createDb,
  createUser,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignRole, loadUserAccess, replaceLocationScopes } from "./access";
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

      const begun = await beginPasswordReset(store, deps(now), {
        organizationId: orgId,
        identifier: user.email ?? "",
      });
      expect(begun.ok).toBe(true);
      const token = begun.token ?? "";
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
});
