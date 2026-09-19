import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../client";
import type { DbClient } from "../client";
import { assignRole } from "./access";
import {
  createOrganization,
  createRole,
  findOrganizationByName,
  findRoleByCode,
  hasRoleGrant,
} from "./bootstrap";
import { inRollback, uniqueName } from "./test-support";
import { createUser } from "./users";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("bootstrap repository primitives", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("creates an organization, role and owner grant and reads them back", async () => {
    await inRollback(client.db, async (tx) => {
      const name = uniqueName("Bootstrap Org");
      const org = await createOrganization(tx, { legalName: name });
      expect((await findOrganizationByName(tx, name))?.id).toBe(org.id);

      const role = await createRole(tx, { organizationId: org.id, code: "owner", name: "Owner" });
      expect((await findRoleByCode(tx, org.id, "owner"))?.id).toBe(role.id);
      expect(await hasRoleGrant(tx, org.id, "owner")).toBe(false);

      const user = await createUser(tx, {
        organizationId: org.id,
        username: uniqueName("owner"),
        displayName: "Owner",
        passwordHash: "hash-v1",
      });
      await assignRole(tx, {
        userId: user.id,
        roleId: role.id,
        locationId: null,
        grantedBy: null,
      });
      expect(await hasRoleGrant(tx, org.id, "owner")).toBe(true);
    });
  });

  it("matches the organization name case-insensitively and trimmed", async () => {
    await inRollback(client.db, async (tx) => {
      const name = uniqueName("Bootstrap Org");
      const org = await createOrganization(tx, { legalName: name });
      expect((await findOrganizationByName(tx, `  ${name.toUpperCase()}  `))?.id).toBe(org.id);
      expect(await findOrganizationByName(tx, `${name}-missing`)).toBeUndefined();
    });
  });
});
