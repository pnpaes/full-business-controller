import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import { createTestOrganization, createTestUser, inRollback, uniqueSuffix } from "./test-support";
import {
  confirmTotp,
  getTotp,
  setLastUsedCounter,
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

  it("advances the replay counter monotonically", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const enrolled = await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");
      expect(enrolled.lastUsedCounter).toBeNull();

      expect((await setLastUsedCounter(tx, user.id, 5)).lastUsedCounter).toBe(5);
      // A stale, slower verification must not move the counter backwards.
      expect((await setLastUsedCounter(tx, user.id, 3)).lastUsedCounter).toBe(5);
      expect((await setLastUsedCounter(tx, user.id, 7)).lastUsedCounter).toBe(7);
    });
  });

  it("rejects a negative counter without writing", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      await upsertTotpSecret(tx, user.id, "v1.aaaa.bbbb.cccc");

      await expect(setLastUsedCounter(tx, user.id, -1)).rejects.toThrow(
        "counter must be non-negative",
      );
      expect((await getTotp(tx, user.id))?.lastUsedCounter).toBeNull();
    });
  });

  it("throws when the user has no TOTP enrolment", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      await expect(setLastUsedCounter(tx, user.id, 5)).rejects.toThrow(
        "user has no TOTP enrolment",
      );
    });
  });
});
