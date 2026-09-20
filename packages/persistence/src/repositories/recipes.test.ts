import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization, recipe } from "../schema";
import { listRecipesForOrganization } from "./recipes";
import { createTestOrganization, inRollback, uniqueName, uniqueSuffix } from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("recipes repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(recipe).where(eq(recipe.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("lists the organization's recipes ordered by code", async () => {
    await inRollback(client.db, async (tx) => {
      await tx.insert(recipe).values([
        { organizationId: orgId, code: `${uniqueName("Z")}`, name: "Zeta" },
        { organizationId: orgId, code: `${uniqueName("A")}`, name: "Alpha" },
        { organizationId: orgId, code: `${uniqueName("M")}`, name: "Mu" },
      ]);

      const rows = await listRecipesForOrganization(tx, { organizationId: orgId });
      expect(rows.map((row) => row.name)).toEqual(["Alpha", "Mu", "Zeta"]);
    });
  });

  it("scopes the list to one organization", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      await tx
        .insert(recipe)
        .values({ organizationId: otherOrgId, code: uniqueName("X"), name: "Other" });
      await tx
        .insert(recipe)
        .values({ organizationId: orgId, code: uniqueName("MINE"), name: "Mine" });

      const rows = await listRecipesForOrganization(tx, { organizationId: orgId });
      expect(rows.map((row) => row.name)).toEqual(["Mine"]);
    });
  });

  it("filters case-insensitively on code and name and treats a blank search as absent", async () => {
    await inRollback(client.db, async (tx) => {
      await tx
        .insert(recipe)
        .values({ organizationId: orgId, code: uniqueName("SAUCE"), name: "Tomato Sauce" });
      await tx
        .insert(recipe)
        .values({ organizationId: orgId, code: uniqueName("DOUGH"), name: "Pizza Dough" });

      const byName = await listRecipesForOrganization(tx, {
        organizationId: orgId,
        search: "tomato",
      });
      expect(byName.map((row) => row.name)).toEqual(["Tomato Sauce"]);

      const blank = await listRecipesForOrganization(tx, { organizationId: orgId, search: "   " });
      expect(blank).toHaveLength(2);
    });
  });

  it("escapes LIKE metacharacters so a search is a literal substring", async () => {
    await inRollback(client.db, async (tx) => {
      await tx
        .insert(recipe)
        .values({ organizationId: orgId, code: uniqueName("PLAIN"), name: "Plain" });
      await tx
        .insert(recipe)
        .values({ organizationId: orgId, code: uniqueName("PCT"), name: "100% Arabica" });

      // A bare `%` is escaped, so it matches only the literal percentage.
      const rows = await listRecipesForOrganization(tx, { organizationId: orgId, search: "%" });
      expect(rows.map((row) => row.name)).toEqual(["100% Arabica"]);
    });
  });

  it("applies limit and offset", async () => {
    await inRollback(client.db, async (tx) => {
      await tx.insert(recipe).values({ organizationId: orgId, code: uniqueName("R"), name: "R1" });
      await tx.insert(recipe).values({ organizationId: orgId, code: uniqueName("R"), name: "R2" });
      await tx.insert(recipe).values({ organizationId: orgId, code: uniqueName("R"), name: "R3" });

      const page = await listRecipesForOrganization(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(page).toHaveLength(1);
      expect(page[0]!.name).toBe("R2");
    });
  });
});
