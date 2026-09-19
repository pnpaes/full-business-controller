import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import {
  createTestOrganization,
  createTestUser,
  inRollback,
  uniqueName,
  uniqueSuffix,
} from "./test-support";
import {
  findUserById,
  findUserByIdentifier,
  recordLoginFailure,
  recordLoginSuccess,
  setTotpEnabled,
  setUserStatus,
  updatePasswordHash,
} from "./users";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("user repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(appUser).where(eq(appUser.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("finds a user by username or email, ignoring case and surrounding space", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const byEmail = await findUserByIdentifier(tx, orgId, user.email!.toUpperCase());
      expect(byEmail?.id).toBe(user.id);

      const byUsername = await findUserByIdentifier(tx, orgId, `  ${user.username}  `);
      expect(byUsername?.id).toBe(user.id);
    });
  });

  it("finds a user by id and returns undefined for an unknown id", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      expect((await findUserById(tx, user.id))?.id).toBe(user.id);
      expect(await findUserById(tx, randomUUID())).toBeUndefined();
    });
  });

  it("returns undefined for an unknown identifier", async () => {
    await inRollback(client.db, async (tx) => {
      expect(
        await findUserByIdentifier(tx, orgId, `missing_${uniqueName("x")}@example.test`),
      ).toBeUndefined();
    });
  });

  it("resolves the same identifier to the user of the requested organization", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, `${suffix}_other`);
      const identifier = uniqueName("shared");
      const first = await createTestUser(tx, orgId, {
        username: identifier,
        email: `${uniqueName("a")}@example.test`,
      });
      const second = await createTestUser(tx, otherOrgId, {
        username: identifier,
        email: `${uniqueName("b")}@example.test`,
      });

      expect((await findUserByIdentifier(tx, orgId, identifier))?.id).toBe(first.id);
      expect((await findUserByIdentifier(tx, otherOrgId, identifier))?.id).toBe(second.id);
    });
  });

  it("throws when one identifier matches a username and an email in the same organization", async () => {
    await inRollback(client.db, async (tx) => {
      const identifier = uniqueName("collision");
      await createTestUser(tx, orgId, {
        username: identifier,
        email: `${uniqueName("a")}@example.test`,
      });
      await createTestUser(tx, orgId, {
        username: uniqueName("user"),
        email: identifier,
      });

      await expect(findUserByIdentifier(tx, orgId, identifier)).rejects.toThrow(
        "identifier matches more than one user in the organization",
      );
    });
  });

  it("increments failures, applies and clears the lock, and records the login time", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);

      const first = await recordLoginFailure(tx, user.id, { lockedUntil: null });
      expect(first?.failedLoginCount).toBe(1);
      expect(first?.lockedUntil).toBeNull();

      const lockUntil = new Date(Date.now() + 60_000);
      const second = await recordLoginFailure(tx, user.id, { lockedUntil: lockUntil });
      expect(second?.failedLoginCount).toBe(2);
      expect(second?.lockedUntil?.getTime()).toBe(lockUntil.getTime());

      const at = new Date();
      const success = await recordLoginSuccess(tx, user.id, at);
      expect(success?.failedLoginCount).toBe(0);
      expect(success?.lockedUntil).toBeNull();
      expect(success?.lastLoginAt?.getTime()).toBe(at.getTime());
    });
  });

  it("rejects a lockedUntil that is not in the future", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const at = new Date();

      await expect(
        recordLoginFailure(tx, user.id, { lockedUntil: new Date(at.getTime() - 1_000), at }),
      ).rejects.toThrow("lockedUntil must be in the future");
      await expect(recordLoginFailure(tx, user.id, { lockedUntil: at, at })).rejects.toThrow(
        "lockedUntil must be in the future",
      );

      // The rejection happened before any write, so the counter is untouched.
      expect((await findUserByIdentifier(tx, orgId, user.email!))?.failedLoginCount).toBe(0);
    });
  });

  it("updates the password hash and user status, returning undefined for an unknown user", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);

      const updated = await updatePasswordHash(tx, user.id, "hash-v2");
      expect(updated?.passwordHash).toBe("hash-v2");
      expect(updated?.passwordChangedAt).toBeInstanceOf(Date);

      const disabled = await setUserStatus(tx, user.id, "disabled");
      expect(disabled?.status).toBe("disabled");

      expect(await updatePasswordHash(tx, randomUUID(), "hash-v3")).toBeUndefined();
      expect(await setUserStatus(tx, randomUUID(), "active")).toBeUndefined();
      expect(await recordLoginSuccess(tx, randomUUID())).toBeUndefined();
    });
  });

  it("toggles totp_enabled and returns undefined for an unknown user", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      expect(user.totpEnabled).toBe(false);

      expect((await setTotpEnabled(tx, user.id, true))?.totpEnabled).toBe(true);
      expect((await findUserById(tx, user.id))?.totpEnabled).toBe(true);
      expect((await setTotpEnabled(tx, user.id, false))?.totpEnabled).toBe(false);
      expect(await setTotpEnabled(tx, randomUUID(), true)).toBeUndefined();
    });
  });
});
