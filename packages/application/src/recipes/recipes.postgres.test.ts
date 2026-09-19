import {
  allergen,
  createCostObservation,
  createDb,
  createSupplier,
  createSupplierItem,
  createSupplierPrice,
  findRecipeById,
  item,
  listRecipeAllergens,
  listRecipeLines,
  listRecipeVersions,
  recipe,
  recipeAllergen,
  recipeVersion,
  unit,
  unitConversion,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeRecipeCost } from "./compute-recipe-cost";
import { loadRecipeVersionAsOf } from "./load-recipe-version";
import { createPostgresRecipeStore } from "./postgres-store";
import { registerAllergen } from "./register-allergen";
import { registerRecipe } from "./register-recipe";
import { registerRecipeVersion } from "./register-recipe-version";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

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

const EARLY = new Date("2025-01-01T00:00:00Z");
const AS_OF = new Date("2026-06-01T00:00:00Z");

describe.skipIf(!databaseUrl)("recipes against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Recipes IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  async function insertItem(
    tx: DatabaseTransaction,
    code: string,
    baseUnitId: string,
    currentCost: string | null = null,
  ): Promise<string> {
    const rows = await tx
      .insert(item)
      .values({
        organizationId: orgId,
        code: `${code}_${suffix}`,
        sku: `${code}_${suffix}`,
        name: code,
        itemType: "ingredient",
        baseUnitId,
        currentCost,
      })
      .returning();
    return rows[0]!.id;
  }

  interface Fixture {
    readonly g: string;
    readonly kg: string;
  }

  async function createFixture(tx: DatabaseTransaction): Promise<Fixture> {
    const g = await tx
      .insert(unit)
      .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
      .returning();
    const kg = await tx
      .insert(unit)
      .values({ organizationId: orgId, code: `kg_${suffix}`, dimension: "mass", isBase: false })
      .returning();
    await tx.insert(unitConversion).values({
      organizationId: orgId,
      fromUnitId: kg[0]!.id,
      toUnitId: g[0]!.id,
      factor: "1000",
      effectiveFrom: EARLY,
    });
    return { g: g[0]!.id, kg: kg[0]!.id };
  }

  async function insertSupplierPrice(
    tx: DatabaseTransaction,
    itemId: string,
    landedBaseUnitCost: string,
    effectiveTo: Date | null = null,
  ): Promise<void> {
    const supplier = await createSupplier(tx, {
      organizationId: orgId,
      code: `sup_${suffix}`,
      name: "Supplier",
    });
    const supplierItem = await createSupplierItem(tx, {
      organizationId: orgId,
      supplierId: supplier.id,
      itemId,
      supplierSku: `SSKU_${suffix}`,
      packUnitId: (await tx.select().from(unit).limit(1))[0]!.id,
      packToBaseUnitFactor: "1000",
    });
    await createSupplierPrice(tx, {
      organizationId: orgId,
      supplierItemId: supplierItem.id,
      grossPackPrice: "100",
      taxBasis: "exclusive",
      netPackPrice: "100",
      landedPackCost: "100",
      landedBaseUnitCost,
      currency: "NOK",
      effectiveFrom: EARLY,
      effectiveTo,
    });
  }

  it("registers a version through the store and computes the §6 formula", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const flour = await insertItem(tx, "flour", g);
      const dough = await insertItem(tx, "dough", g);
      await insertSupplierPrice(tx, flour, "0.2000");

      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      const registered = await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "0.800000",
        effectiveFrom: EARLY,
        approvedBy: randomUUID(),
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0.800000", unitId: g }],
      });
      expect(registered.yieldRate).toBe("0.800000");

      const loaded = await loadRecipeVersionAsOf(store, {
        organizationId: orgId,
        recipeId,
        asOf: AS_OF,
      });
      expect(loaded.version.id).toBe(registered.recipeVersionId);
      expect(await listRecipeLines(tx, registered.recipeVersionId)).toHaveLength(1);

      const cost = await computeRecipeCost(store, {
        organizationId: orgId,
        recipeVersionId: registered.recipeVersionId,
        asOf: AS_OF,
      });
      // required = 0.8 / 0.8 = 1.000000; line = 1 × 0.2 = 0.2000; per unit = 0.2 / 0.8.
      expect(cost.components[0]).toMatchObject({
        requiredPurchaseQuantity: "1.000000",
        lineCost: "0.2000",
        sourceType: "supplier_price",
      });
      expect(cost.costPerUsableOutputUnit).toBe("0.2500");
      expect(await findRecipeById(tx, recipeId)).toMatchObject({ organizationId: orgId });
    });
  });

  it("converts a kg line into the item's gram base unit", async () => {
    await inRollback(client.db, async (tx) => {
      const { g, kg } = await createFixture(tx);
      const flour = await insertItem(tx, "flour", g);
      const dough = await insertItem(tx, "dough", g);
      await insertSupplierPrice(tx, flour, "0.2000");
      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      const { recipeVersionId } = await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "0.800000",
        effectiveFrom: EARLY,
        approvedBy: randomUUID(),
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0.000800", unitId: kg }],
      });
      const cost = await computeRecipeCost(store, {
        organizationId: orgId,
        recipeVersionId,
        asOf: AS_OF,
      });
      expect(cost.components[0]!.requiredPurchaseQuantity).toBe("1.000000");
      expect(cost.components[0]!.lineCost).toBe("0.2000");
    });
  });

  it("excludes expired supplier prices and future cost observations", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const flour = await insertItem(tx, "flour", g, "7.0000");
      const dough = await insertItem(tx, "dough", g);
      // Expired before AS_OF …
      await insertSupplierPrice(tx, flour, "0.2000", new Date("2025-06-01T00:00:00Z"));
      // … and observed after AS_OF; both must be ignored, leaving current_cost.
      await createCostObservation(tx, {
        organizationId: orgId,
        itemId: flour,
        observedAt: "2026-07-01",
        packSize: "1000.000000",
        packUnitId: g,
        packPrice: "500.0000",
        currency: "NOK",
        source: "manual",
      });
      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      const { recipeVersionId } = await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        approvedBy: randomUUID(),
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "1.000000", unitId: g }],
      });
      const cost = await computeRecipeCost(store, {
        organizationId: orgId,
        recipeVersionId,
        asOf: AS_OF,
      });
      expect(cost.components[0]).toMatchObject({
        sourceType: "current_cost",
        unitCost: "7.0000",
      });
    });
  });

  it("rejects a yield boundary above 1 at registration", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const flour = await insertItem(tx, "flour", g);
      const dough = await insertItem(tx, "dough", g);
      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      await expect(
        registerRecipeVersion(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          recipeId,
          versionNo: 1,
          plannedInputQty: "1.000000",
          plannedOutputQty: "1.000000",
          approvedUsableOutput: "1.500000",
          effectiveFrom: EARLY,
          lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0.800000", unitId: g }],
        }),
      ).rejects.toThrow(/must not exceed 1/);
    });
  });

  it("composes a nested sub-recipe bottom-up", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const tomato = await insertItem(tx, "tomato", g);
      const sauceItem = await insertItem(tx, "sauce", g);
      const pizzaItem = await insertItem(tx, "pizza", g);
      await insertSupplierPrice(tx, tomato, "0.1000");
      const store = createPostgresRecipeStore(tx);

      const { recipeId: sauceRecipe } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "SAUCE",
        name: "Sauce",
        outputItemId: sauceItem,
      });
      await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId: sauceRecipe,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        approvedBy: randomUUID(),
        lines: [{ componentKind: "ingredient", itemId: tomato, quantity: "0.500000", unitId: g }],
      });

      const { recipeId: pizzaRecipe } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "PIZZA",
        name: "Pizza",
        outputItemId: pizzaItem,
      });
      const { recipeVersionId } = await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId: pizzaRecipe,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        approvedBy: randomUUID(),
        lines: [
          {
            componentKind: "sub_recipe",
            subRecipeId: sauceRecipe,
            quantity: "0.300000",
            unitId: g,
          },
        ],
      });

      const cost = await computeRecipeCost(store, {
        organizationId: orgId,
        recipeVersionId,
        asOf: AS_OF,
      });
      // Sauce: 0.5 × 0.1 = 0.0500 per 1 g. Pizza: 0.3 × 0.05 = 0.0150.
      expect(cost.components[0]).toMatchObject({ sourceType: "sub_recipe", lineCost: "0.0150" });
      expect(cost.costPerUsableOutputUnit).toBe("0.0150");
    });
  });

  it("rejects a direct self-reference and a mutual recursion (COST-002)", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const itemA = await insertItem(tx, "a", g);
      const itemB = await insertItem(tx, "b", g);
      const store = createPostgresRecipeStore(tx);
      const { recipeId: a } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "A",
        name: "A",
        outputItemId: itemA,
      });
      const { recipeId: b } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "B",
        name: "B",
        outputItemId: itemB,
      });

      await expect(
        registerRecipeVersion(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          recipeId: a,
          versionNo: 1,
          plannedInputQty: "1.000000",
          plannedOutputQty: "1.000000",
          approvedUsableOutput: "1.000000",
          effectiveFrom: EARLY,
          lines: [{ componentKind: "sub_recipe", subRecipeId: a, quantity: "1", unitId: g }],
        }),
      ).rejects.toThrow(/must not contain itself/);

      await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId: a,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        lines: [{ componentKind: "sub_recipe", subRecipeId: b, quantity: "1", unitId: g }],
      });
      await expect(
        registerRecipeVersion(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          recipeId: b,
          versionNo: 1,
          plannedInputQty: "1.000000",
          plannedOutputQty: "1.000000",
          approvedUsableOutput: "1.000000",
          effectiveFrom: EARLY,
          lines: [{ componentKind: "sub_recipe", subRecipeId: a, quantity: "1", unitId: g }],
        }),
      ).rejects.toThrow(/circular sub-recipes/);
    });
  });

  it("loads version effective dating and rejects a date before the window", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const dough = await insertItem(tx, "dough", g);
      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        lines: [{ componentKind: "ingredient", itemId: dough, quantity: "1", unitId: g }],
      });
      const loaded = await loadRecipeVersionAsOf(store, {
        organizationId: orgId,
        recipeId,
        asOf: AS_OF,
      });
      expect(loaded.version.versionNo).toBe(1);
      await expect(
        loadRecipeVersionAsOf(store, {
          organizationId: orgId,
          recipeId,
          asOf: new Date("2024-12-31T00:00:00Z"),
        }),
      ).rejects.toThrow(/no recipe version is effective/);
    });
  });

  it("stores and reads allergen declarations with their master identity", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const dough = await insertItem(tx, "dough", g);
      const store = createPostgresRecipeStore(tx);
      const { recipeId } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "DOUGH",
        name: "Dough",
        outputItemId: dough,
      });
      const { allergenId } = await registerAllergen(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "GLUTEN",
        name: "Gluten",
        isDerived: true,
      });
      const { recipeVersionId } = await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        lines: [{ componentKind: "ingredient", itemId: dough, quantity: "1", unitId: g }],
        allergens: [{ allergenId, source: "verified", verifiedBy: randomUUID() }],
      });
      const declarations = await listRecipeAllergens(tx, recipeVersionId);
      expect(declarations).toEqual([
        {
          allergenId,
          code: "GLUTEN",
          name: "Gluten",
          isDerived: true,
          source: "verified",
          verifiedBy: expect.any(String),
        },
      ]);
    });
  });

  async function withRecipeVersion(
    fn: (
      tx: DatabaseTransaction,
      ctx: { readonly versionId: string; readonly allergenId: string },
    ) => Promise<void>,
  ): Promise<void> {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const dough = await insertItem(tx, "dough", g);
      const recipeRow = (
        await tx
          .insert(recipe)
          .values({ organizationId: orgId, code: `R_${suffix}`, name: "R", outputItemId: dough })
          .returning()
      )[0]!;
      const versionRow = (
        await tx
          .insert(recipeVersion)
          .values({
            recipeId: recipeRow.id,
            versionNo: 1,
            plannedInputQty: "1",
            plannedOutputQty: "1",
            approvedUsableOutput: "1",
            yieldRate: "1",
            effectiveFrom: EARLY,
          })
          .returning()
      )[0]!;
      const allergenRow = (
        await tx
          .insert(allergen)
          .values({ organizationId: orgId, code: `GLUTEN_${suffix}`, name: "Gluten" })
          .returning()
      )[0]!;
      await fn(tx, { versionId: versionRow.id, allergenId: allergenRow.id });
    });
  }

  it("enforces the 0009 allergen invariants", async () => {
    // Each failing statement runs in its own rolled-back transaction, because a
    // constraint violation aborts the surrounding transaction.

    // Duplicate allergen code (allergen_organization_id_code_key).
    await withRecipeVersion(async (tx) => {
      await expect(
        (async () =>
          tx.insert(allergen).values({
            organizationId: orgId,
            code: `GLUTEN_${suffix}`,
            name: "Gluten again",
          }))(),
      ).rejects.toThrow();
    });

    // Duplicate declaration (recipe_allergen composite primary key).
    await withRecipeVersion(async (tx, { versionId, allergenId }) => {
      await tx
        .insert(recipeAllergen)
        .values({ recipeVersionId: versionId, allergenId, source: "derived" });
      await expect(
        (async () =>
          tx
            .insert(recipeAllergen)
            .values({ recipeVersionId: versionId, allergenId, source: "derived" }))(),
      ).rejects.toThrow();
    });

    // Invalid source value (recipe_allergen_source_check).
    await withRecipeVersion(async (tx, { versionId }) => {
      const other = (
        await tx
          .insert(allergen)
          .values({ organizationId: orgId, code: `NUTS_${suffix}`, name: "Nuts" })
          .returning()
      )[0]!;
      await expect(
        (async () =>
          tx
            .insert(recipeAllergen)
            .values({ recipeVersionId: versionId, allergenId: other.id, source: "bogus" }))(),
      ).rejects.toThrow();
    });

    // A verified declaration without verified_by (recipe_allergen_verified_check).
    await withRecipeVersion(async (tx, { versionId }) => {
      const soy = (
        await tx
          .insert(allergen)
          .values({ organizationId: orgId, code: `SOY_${suffix}`, name: "Soy" })
          .returning()
      )[0]!;
      await expect(
        (async () =>
          tx
            .insert(recipeAllergen)
            .values({ recipeVersionId: versionId, allergenId: soy.id, source: "verified" }))(),
      ).rejects.toThrow();
    });
  });

  it("lists existing sub-recipe edges through the store", async () => {
    await inRollback(client.db, async (tx) => {
      const { g } = await createFixture(tx);
      const itemA = await insertItem(tx, "a", g);
      const itemB = await insertItem(tx, "b", g);
      const store = createPostgresRecipeStore(tx);
      const { recipeId: a } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "A",
        name: "A",
        outputItemId: itemA,
      });
      const { recipeId: b } = await registerRecipe(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: "B",
        name: "B",
        outputItemId: itemB,
      });
      await registerRecipeVersion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        recipeId: a,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: EARLY,
        lines: [{ componentKind: "sub_recipe", subRecipeId: b, quantity: "1", unitId: g }],
      });
      expect(await store.listSubRecipeEdges(orgId)).toContainEqual({
        parentRecipeId: a,
        childRecipeId: b,
      });
      expect(await listRecipeVersions(tx, a)).toHaveLength(1);
    });
  });
});
