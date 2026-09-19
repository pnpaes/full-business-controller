import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, organization } from "../schema";
import {
  assignRole,
  listAssignableRoles,
  listUserLocationScopes,
  listUserRoles,
  removeRole,
  replaceLocationScopes,
} from "./access";
import {
  createTestLocation,
  createTestOrganization,
  createTestRole,
  createTestUser,
  inRollback,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("access repository", () => {
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

  it("round-trips roles and location scopes", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const owner = await createTestRole(tx, orgId, { code: "owner", name: "Owner" });
      const admin = await createTestRole(tx, orgId, { code: "admin", name: "Admin" });
      const location = await createTestLocation(tx, orgId);

      await assignRole(tx, {
        userId: user.id,
        roleId: owner.id,
        locationId: null,
        grantedBy: null,
      });
      await assignRole(tx, {
        userId: user.id,
        roleId: admin.id,
        locationId: location.id,
        grantedBy: user.id,
      });

      const roles = await listUserRoles(tx, user.id);
      expect(roles).toHaveLength(2);
      expect(roles.map((row) => row.code).sort()).toEqual(["admin", "owner"]);
      expect(roles.find((row) => row.code === "admin")?.locationId).toBe(location.id);
      expect(roles.find((row) => row.code === "owner")?.locationId).toBeNull();

      await replaceLocationScopes(tx, user.id, [location.id]);
      expect(await listUserLocationScopes(tx, user.id)).toEqual([{ locationId: location.id }]);

      const assignable = await listAssignableRoles(tx, orgId);
      expect(assignable.map((row) => row.code).sort()).toEqual(["admin", "owner"]);
      expect(await listAssignableRoles(tx, randomUUID())).toEqual([]);
    });
  });

  it("treats a duplicate grant as idempotent, including a null location", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const owner = await createTestRole(tx, orgId);
      const location = await createTestLocation(tx, orgId);
      const grant = { userId: user.id, roleId: owner.id, grantedBy: null };

      await assignRole(tx, { ...grant, locationId: null });
      await assignRole(tx, { ...grant, locationId: null });
      await assignRole(tx, { ...grant, locationId: location.id });
      await assignRole(tx, { ...grant, locationId: location.id });

      const roles = await listUserRoles(tx, user.id);
      expect(roles).toHaveLength(2);
      expect(roles.filter((row) => row.locationId === null)).toHaveLength(1);
      expect(roles.filter((row) => row.locationId === location.id)).toHaveLength(1);
    });
  });

  it("removes a grant and treats a missing grant as a no-op", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const owner = await createTestRole(tx, orgId);
      const location = await createTestLocation(tx, orgId);

      expect(
        await removeRole(tx, { userId: user.id, roleId: owner.id, locationId: null }),
      ).toBeUndefined();

      await assignRole(tx, {
        userId: user.id,
        roleId: owner.id,
        locationId: location.id,
        grantedBy: null,
      });
      const removed = await removeRole(tx, {
        userId: user.id,
        roleId: owner.id,
        locationId: location.id,
      });
      expect(removed).toBeDefined();
      expect(await listUserRoles(tx, user.id)).toEqual([]);

      // Removing the same grant again is a no-op.
      expect(
        await removeRole(tx, { userId: user.id, roleId: owner.id, locationId: location.id }),
      ).toBeUndefined();
    });
  });

  it("replaces the location scope exactly", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const first = await createTestLocation(tx, orgId);
      const second = await createTestLocation(tx, orgId);
      const third = await createTestLocation(tx, orgId);

      await replaceLocationScopes(tx, user.id, [first.id, second.id, first.id]);
      expect(
        (await listUserLocationScopes(tx, user.id)).map((row) => row.locationId).sort(),
      ).toEqual([first.id, second.id].sort());

      await replaceLocationScopes(tx, user.id, [third.id]);
      expect(await listUserLocationScopes(tx, user.id)).toEqual([{ locationId: third.id }]);

      await replaceLocationScopes(tx, user.id, []);
      expect(await listUserLocationScopes(tx, user.id)).toEqual([]);
    });
  });
});
