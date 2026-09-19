import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import { consumeResetToken, createResetToken, findActiveResetTokenByHash } from "./password-reset";
import { createTestOrganization, createTestUser, inRollback, uniqueSuffix } from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const resetHash = (): string => randomBytes(32).toString("hex");

describe.skipIf(!databaseUrl)("password-reset repository", () => {
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

  it("creates a reset token and finds it while active", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const tokenHash = resetHash();
      const token = await createResetToken(tx, {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      expect(token.tokenHash).toBe(tokenHash);
      const found = await findActiveResetTokenByHash(tx, tokenHash);
      expect(found?.id).toBe(token.id);
      expect(await findActiveResetTokenByHash(tx, resetHash())).toBeUndefined();
    });
  });

  it("consumes a token exactly once", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const tokenHash = resetHash();
      const token = await createResetToken(tx, {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      const consumed = await consumeResetToken(tx, token.id);
      expect(consumed?.usedAt).toBeInstanceOf(Date);
      expect(consumed?.id).toBe(token.id);

      expect(await consumeResetToken(tx, token.id)).toBeUndefined();
      expect(await findActiveResetTokenByHash(tx, tokenHash)).toBeUndefined();
    });
  });

  it("does not return an expired token", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const tokenHash = resetHash();
      await createResetToken(tx, {
        userId: user.id,
        tokenHash,
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      });

      expect(await findActiveResetTokenByHash(tx, tokenHash)).toBeUndefined();
    });
  });

  it("cannot consume an expired token even without the active-token lookup", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const token = await createResetToken(tx, {
        userId: user.id,
        tokenHash: resetHash(),
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      });

      expect(await consumeResetToken(tx, token.id)).toBeUndefined();
    });
  });
});
