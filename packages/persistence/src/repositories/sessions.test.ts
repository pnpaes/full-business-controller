import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import {
  createSession,
  findActiveSessionByTokenHash,
  revokeAllSessionsForUser,
  revokeSession,
} from "./sessions";
import { createTestOrganization, createTestUser, inRollback, uniqueSuffix } from "./test-support";
import { setUserStatus } from "./users";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const sessionHash = (): string => randomBytes(32).toString("hex");

describe.skipIf(!databaseUrl)("session repository", () => {
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

  it("stores only the token hash and finds an active session", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const tokenHash = sessionHash();
      const session = await createSession(tx, {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        userAgent: "vitest",
      });

      expect(session.tokenHash).toBe(tokenHash);
      expect(session.userAgent).toBe("vitest");

      const found = await findActiveSessionByTokenHash(tx, tokenHash);
      expect(found?.id).toBe(session.id);
      expect(await findActiveSessionByTokenHash(tx, sessionHash())).toBeUndefined();
    });
  });

  it("rejects revoked and expired sessions", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);

      const revokedHash = sessionHash();
      const revoked = await createSession(tx, {
        userId: user.id,
        tokenHash: revokedHash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const revokedRow = await revokeSession(tx, revoked.id);
      expect(revokedRow?.revokedAt).toBeInstanceOf(Date);
      expect(await findActiveSessionByTokenHash(tx, revokedHash)).toBeUndefined();

      // Revoking again is a no-op, not an error.
      expect(await revokeSession(tx, revoked.id)).toBeUndefined();

      const expiredHash = sessionHash();
      await createSession(tx, {
        userId: user.id,
        tokenHash: expiredHash,
        issuedAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      });
      expect(await findActiveSessionByTokenHash(tx, expiredHash)).toBeUndefined();
    });
  });

  it("rejects a session whose user is no longer active", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const tokenHash = sessionHash();
      await createSession(tx, {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      expect((await findActiveSessionByTokenHash(tx, tokenHash))?.userId).toBe(user.id);

      await setUserStatus(tx, user.id, "disabled");
      expect(await findActiveSessionByTokenHash(tx, tokenHash)).toBeUndefined();
    });
  });

  it("revokes every active session for a user", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const hashes = [sessionHash(), sessionHash(), sessionHash()];

      for (const tokenHash of hashes) {
        await createSession(tx, {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      }

      // One is already revoked, so only the other two remain active.
      const first = await findActiveSessionByTokenHash(tx, hashes[0]!);
      await revokeSession(tx, first!.id);

      expect(await revokeAllSessionsForUser(tx, user.id)).toBe(2);
      expect(await revokeAllSessionsForUser(tx, user.id)).toBe(0);
    });
  });
});
