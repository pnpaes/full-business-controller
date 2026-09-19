import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import { createTestOrganization, createTestUser, inRollback, uniqueSuffix } from "./test-support";
import {
  advanceLastUsedCounter,
  confirmTotp,
  consumeRecoveryCodeHash,
  getTotp,
  setRecoveryCodes,
  upsertTotpSecret,
} from "./totp";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("totp repository", () => {
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

  it("returns undefined before enrolment", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      expect(await getTotp(tx, user.id)).toBeUndefined();
    });
  });

  it("upserts a sealed secret, confirms it and stores recovery codes", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);

      const created = await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");
      expect(created.secretEncrypted).toBe("v1.aaaa.bbbb.cccc");
      expect(created.confirmedAt).toBeNull();
      expect(created.recoveryCodesHash).toEqual([]);

      const at = new Date();
      const confirmed = await confirmTotp(tx, user.id, at);
      expect(confirmed?.confirmedAt?.getTime()).toBe(at.getTime());

      const hashed = ["hash-a", "hash-b"];
      const withCodes = await setRecoveryCodes(tx, user.id, hashed);
      expect(withCodes?.recoveryCodesHash).toEqual(hashed);

      // A second upsert replaces the sealed secret without creating a second row.
      const replaced = await upsertTotpSecret(tx, user.id, "v1.dddd.eeee.ffff");
      expect(replaced.secretEncrypted).toBe("v1.dddd.eeee.ffff");
      expect(await getTotp(tx, user.id)).toMatchObject({ secretEncrypted: "v1.dddd.eeee.ffff" });
    });
  });

  it("advances the replay counter only when it moves forward", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const enrolled = await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");
      expect(enrolled.lastUsedCounter).toBeNull();

      expect((await advanceLastUsedCounter(tx, user.id, 5))?.lastUsedCounter).toBe(5);
      // A stale or concurrent verification loses the compare-and-set.
      expect(await advanceLastUsedCounter(tx, user.id, 3)).toBeUndefined();
      expect(await advanceLastUsedCounter(tx, user.id, 5)).toBeUndefined();
      expect((await advanceLastUsedCounter(tx, user.id, 7))?.lastUsedCounter).toBe(7);
    });
  });

  it("rejects a negative counter without writing", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");

      await expect(advanceLastUsedCounter(tx, user.id, -1)).rejects.toThrow(
        "counter must be a non-negative integer",
      );
      expect((await getTotp(tx, user.id))?.lastUsedCounter).toBeNull();
    });
  });

  it("returns undefined when the user has no TOTP enrolment", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      expect(await advanceLastUsedCounter(tx, user.id, 5)).toBeUndefined();
    });
  });

  it("consumes a recovery-code hash exactly once", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");
      await setRecoveryCodes(tx, user.id, ["hash-a", "hash-b"]);

      const consumed = await consumeRecoveryCodeHash(tx, user.id, "hash-a");
      expect(consumed?.recoveryCodesHash).toEqual(["hash-b"]);
      // A concurrent second consume matches nothing.
      expect(await consumeRecoveryCodeHash(tx, user.id, "hash-a")).toBeUndefined();
    });
  });
});
