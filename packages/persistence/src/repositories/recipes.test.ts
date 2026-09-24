import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization, recipe, recipeTest, recipeVersion } from "../schema";
import {
  createRecipeTest,
  findRecipeTestById,
  linkRecipeTestToVersion,
  listRecipeTestsByRecipe,
  listRecipeTestsByVersion,
  listRecipesForOrganization,
} from "./recipes";
import {
  createTestOrganization,
  createTestRecipe,
  createTestRecipeVersion,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

function makeTrial(
  organizationId: string,
  recipeVersionId: string,
  overrides: Partial<typeof recipeTest.$inferInsert> = {},
): typeof recipeTest.$inferInsert {
  return {
    organizationId,
    recipeVersionId,
    testedAt: new Date("2026-02-01T00:00:00.000Z"),
    batchInputQty: "2.000000",
    actorId: "00000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

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

describe.skipIf(!databaseUrl)("recipe_test repository (DEC-123)", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("lists trials by recipe and by version, newest tested first, org-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const recipeRow = await createTestRecipe(tx, orgId, { code: uniqueName("TRIAL") });
      const version1 = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 1 });
      const version2 = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 2 });

      await createRecipeTest(
        tx,
        makeTrial(orgId, version1.id, { testedAt: new Date("2026-01-01T00:00:00.000Z") }),
      );
      await createRecipeTest(
        tx,
        makeTrial(orgId, version1.id, {
          testedAt: new Date("2026-03-01T00:00:00.000Z"),
          actualOutputQty: "0.750000",
        }),
      );
      await createRecipeTest(
        tx,
        makeTrial(orgId, version2.id, { testedAt: new Date("2026-02-01T00:00:00.000Z") }),
      );

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherRecipe = await createTestRecipe(tx, otherOrgId, { code: uniqueName("FOREIGN") });
      const otherVersion = await createTestRecipeVersion(tx, otherRecipe.id, { versionNo: 1 });
      await createRecipeTest(tx, makeTrial(otherOrgId, otherVersion.id));

      const byRecipe = await listRecipeTestsByRecipe(tx, orgId, recipeRow.id);
      expect(byRecipe.map((row) => row.testedAt.toISOString())).toEqual([
        "2026-03-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ]);
      expect(byRecipe.every((row) => row.recipeId === recipeRow.id)).toBe(true);
      expect(byRecipe[0]!.testedVersionNo).toBe(1);
      expect(byRecipe[0]!.resultingVersionNo).toBeNull();

      const byVersion = await listRecipeTestsByVersion(tx, orgId, version1.id);
      expect(byVersion).toHaveLength(2);
      expect(byVersion.every((row) => row.recipeVersionId === version1.id)).toBe(true);

      // The foreign organization's trial is never returned.
      expect(byRecipe).toHaveLength(3);
    });
  });

  it("links a trial to a version once, from null only", async () => {
    await inRollback(client.db, async (tx) => {
      const recipeRow = await createTestRecipe(tx, orgId, { code: uniqueName("LINK") });
      const tried = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 1 });
      const resulting = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 2 });
      const created = await createRecipeTest(tx, makeTrial(orgId, tried.id));

      const linked = await linkRecipeTestToVersion(tx, created.id, resulting.id);
      expect(linked).toMatchObject({ resultingRecipeVersionId: resulting.id });

      const view = await findRecipeTestById(tx, created.id);
      expect(view).toMatchObject({ resultingVersionNo: 2, resultingVersionState: "draft" });
      expect(view?.recipeId).toBe(recipeRow.id);

      // The narrow update is a null → value write only: a second link is a no-op.
      const again = await linkRecipeTestToVersion(tx, created.id, tried.id);
      expect(again).toBeUndefined();
      // The trial's measured values are untouched by the link.
      expect((await findRecipeTestById(tx, created.id))?.batchInputQty).toBe("2.000000");
    });
  });

  it("rejects a trial whose version does not exist (NO ACTION FK)", async () => {
    await inRollback(client.db, async (tx) => {
      await expect(
        createRecipeTest(tx, makeTrial(orgId, "00000000-0000-4000-8000-0000000000ff")),
      ).rejects.toThrow();
    });
  });

  it("rejects a non-positive batch input (check constraint)", async () => {
    await inRollback(client.db, async (tx) => {
      const recipeRow = await createTestRecipe(tx, orgId, { code: uniqueName("CHECK") });
      const version = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 1 });
      await expect(
        createRecipeTest(tx, makeTrial(orgId, version.id, { batchInputQty: "0" })),
      ).rejects.toThrow();
    });
  });

  it("refuses to delete a version that has a recorded trial", async () => {
    await inRollback(client.db, async (tx) => {
      const recipeRow = await createTestRecipe(tx, orgId, { code: uniqueName("NOACTION") });
      const version = await createTestRecipeVersion(tx, recipeRow.id, { versionNo: 1 });
      const created = await createRecipeTest(tx, makeTrial(orgId, version.id));
      expect(created.id).toBeDefined();

      const cause = await rejectionCause(
        tx.delete(recipeVersion).where(eq(recipeVersion.id, version.id)),
      );
      expect(cause.message).toMatch(/recipe_test/i);
    });
  });
});
