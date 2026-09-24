import { DomainError, NotFoundError, type UnitDimension } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { getRecipe, getRecipeCostPreview, listRecipes } from "./reads";
import { FakeRecipeStore } from "./test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";
const JAN = new Date("2026-01-01T00:00:00Z");
const JUN = new Date("2026-06-01T00:00:00Z");

function makeUnit(store: FakeRecipeStore, code: string, dimension: UnitDimension, isBase: boolean) {
  const id = `unit-${code}`;
  store.units.set(id, { id, code, dimension, isBase });
  return id;
}

function makeItem(
  store: FakeRecipeStore,
  id: string,
  baseUnitId: string,
  currentCost: string | null = null,
) {
  store.items.set(id, {
    id,
    organizationId: ORG,
    code: id,
    name: `Item ${id}`,
    baseUnitId,
    currentCost,
  });
  return id;
}

function makeRecipe(
  store: FakeRecipeStore,
  id: string,
  code: string,
  name: string,
  outputItemId: string | null = null,
  organizationId = ORG,
) {
  store.recipes.set(id, { id, organizationId, code, name, outputItemId });
  return id;
}

function addVersion(
  store: FakeRecipeStore,
  recipeId: string,
  overrides: Partial<{
    versionNo: number;
    state: string;
    plannedInputQty: string;
    approvedUsableOutput: string;
    effectiveFrom: Date;
  }> = {},
) {
  const versionNo = overrides.versionNo ?? store.versions.length + 1;
  const id = `version-${recipeId}-${versionNo}`;
  store.versions.push({
    id,
    recipeId,
    versionNo,
    state: overrides.state ?? "approved",
    plannedInputQty: overrides.plannedInputQty ?? "1.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: overrides.approvedUsableOutput ?? "0.800000",
    yieldRate: "0.800000",
    preparationMinutes: null,
    laborCostCenterId: null,
    laborRoleCode: null,
    effectiveFrom: overrides.effectiveFrom ?? JAN,
    effectiveTo: null,
    approvedBy: ACTOR,
    approvedAt: JAN,
    notes: null,
    method: null,
  });
  return id;
}

function addLine(
  store: FakeRecipeStore,
  versionId: string,
  itemId: string,
  unitId: string,
  quantity = "0.800000",
) {
  store.lines.push({
    id: `line-${store.lines.length + 1}`,
    recipeVersionId: versionId,
    componentKind: "ingredient",
    itemId,
    subRecipeId: null,
    quantity,
    unitId,
    lossFactor: "1.000000",
    stage: null,
    substitutionGroup: null,
  });
}

describe("listRecipes", () => {
  it("lists recipes in code order with the latest version and a cost preview", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const beans = makeItem(store, "item-beans", g, "0.2500");
    makeRecipe(store, "recipe-b", "B_BLEND", "B Blend");
    const a = makeRecipe(store, "recipe-a", "A_BLEND", "A Blend");
    const v1 = addVersion(store, a, { versionNo: 1, state: "draft", effectiveFrom: JAN });
    addLine(store, v1, beans, g);
    const v2 = addVersion(store, a, { versionNo: 2, state: "approved", effectiveFrom: JUN });
    addLine(store, v2, beans, g);

    const listed = await listRecipes(store, { organizationId: ORG });
    expect(listed.map((entry) => entry.recipe.code)).toEqual(["A_BLEND", "B_BLEND"]);

    const first = listed[0]!;
    expect(first.latestVersion?.id).toBe(v2);
    expect(first.costPreview).toMatchObject({
      available: true,
      recipeVersionId: v2,
      currency: "NOK",
      costPerUsableOutputUnit: "0.3125",
    });
    // The recipe without versions has no preview version to cost.
    expect(listed[1]!.latestVersion).toBeNull();
    expect(listed[1]!.costPreview).toMatchObject({ available: false });
  });

  it("filters by search and paginates", async () => {
    const store = new FakeRecipeStore();
    makeRecipe(store, "recipe-a", "SAUCE", "Tomato Sauce");
    makeRecipe(store, "recipe-b", "DOUGH", "Pizza Dough");
    makeRecipe(store, "recipe-c", "SAUCE_2", "Basil Sauce");

    const byName = await listRecipes(store, { organizationId: ORG, search: "sauce" });
    expect(byName.map((entry) => entry.recipe.code)).toEqual(["SAUCE", "SAUCE_2"]);

    const page = await listRecipes(store, { organizationId: ORG, limit: 1, offset: 1 });
    expect(page.map((entry) => entry.recipe.code)).toEqual(["SAUCE"]);
  });

  it("never returns another organization's recipes", async () => {
    const store = new FakeRecipeStore();
    makeRecipe(store, "recipe-other", "OTHER", "Other", null, OTHER_ORG);
    expect(await listRecipes(store, { organizationId: ORG })).toEqual([]);
  });
});

describe("getRecipe", () => {
  it("returns versions newest first with nested lines and allergens", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const beans = makeItem(store, "item-beans", g, "0.2500");
    const recipeId = makeRecipe(store, "recipe-a", "BLEND", "House Blend");
    const v1 = addVersion(store, recipeId, { versionNo: 1, effectiveFrom: JAN });
    addLine(store, v1, beans, g);
    const v2 = addVersion(store, recipeId, { versionNo: 2, effectiveFrom: JUN });
    addLine(store, v2, beans, g, "0.900000");

    const allergen = await store.createAllergen({
      organizationId: ORG,
      code: "GLUTEN",
      name: "Gluten",
      isDerived: false,
    });
    await store.createRecipeAllergen({
      recipeVersionId: v2,
      allergenId: allergen.id,
      source: "derived",
      verifiedBy: null,
    });

    const detail = await getRecipe(store, { organizationId: ORG, recipeId, asOf: JUN });
    expect(detail.versions.map((entry) => entry.version.versionNo)).toEqual([2, 1]);
    expect(detail.versions[0]!.lines[0]!.quantity).toBe("0.900000");
    expect(detail.versions[0]!.allergens).toEqual([
      {
        allergenId: allergen.id,
        code: "GLUTEN",
        name: "Gluten",
        isDerived: false,
        source: "derived",
        verifiedBy: null,
      },
    ]);
    expect(detail.costPreview).toMatchObject({ available: true, recipeVersionId: v2 });
  });

  it("rejects a missing or cross-organization recipe", async () => {
    const store = new FakeRecipeStore();
    makeRecipe(store, "recipe-other", "OTHER", "Other", null, OTHER_ORG);
    await expect(
      getRecipe(store, { organizationId: ORG, recipeId: "missing" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      getRecipe(store, { organizationId: ORG, recipeId: "recipe-other" }),
    ).rejects.toThrow(/not found in organization/);
  });

  it("throws a typed NotFoundError for the top-level lookup (DEC-076)", async () => {
    const store = new FakeRecipeStore();
    const error = await getRecipe(store, { organizationId: ORG, recipeId: "missing" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NotFoundError);
    // A NotFoundError is still a DomainError, so existing 400 handling is safe.
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("getRecipeCostPreview", () => {
  it("reports an unapproved version instead of throwing", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const beans = makeItem(store, "item-beans", g, "0.2500");
    const recipeId = makeRecipe(store, "recipe-a", "BLEND", "House Blend");
    const v1 = addVersion(store, recipeId, { versionNo: 1, state: "draft" });
    addLine(store, v1, beans, g);

    const preview = await getRecipeCostPreview(store, { organizationId: ORG, recipeId, asOf: JUN });
    expect(preview.available).toBe(false);
    if (!preview.available) {
      expect(preview.recipeVersionId).toBe(v1);
      expect(preview.state).toBe("draft");
      expect(preview.reason).toMatch(/only an approved version/);
    }
  });

  it("reports a missing cost source instead of throwing", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const beans = makeItem(store, "item-beans", g, null);
    const recipeId = makeRecipe(store, "recipe-a", "BLEND", "House Blend");
    const v1 = addVersion(store, recipeId, { versionNo: 1, state: "approved" });
    addLine(store, v1, beans, g);

    const preview = await getRecipeCostPreview(store, { organizationId: ORG, recipeId, asOf: JUN });
    expect(preview.available).toBe(false);
    if (!preview.available) {
      expect(preview.recipeVersionId).toBe(v1);
      expect(preview.reason).toMatch(/no cost source available/);
    }
  });

  it("returns the cost breakdown for an approved version with a cost source", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const beans = makeItem(store, "item-beans", g, "0.2500");
    const recipeId = makeRecipe(store, "recipe-a", "BLEND", "House Blend");
    const v1 = addVersion(store, recipeId, { versionNo: 1, state: "approved" });
    addLine(store, v1, beans, g);

    const preview = await getRecipeCostPreview(store, { organizationId: ORG, recipeId, asOf: JUN });
    expect(preview.available).toBe(true);
    if (preview.available) {
      expect(preview.recipeVersionId).toBe(v1);
      expect(preview.yieldRate).toBe("0.800000");
      expect(preview.recipeInputCost).toBe("0.2500");
      expect(preview.costPerUsableOutputUnit).toBe("0.3125");
      expect(preview.components).toHaveLength(1);
      expect(preview.components[0]).toMatchObject({
        sourceType: "current_cost",
        unitCost: "0.2500",
        requiredPurchaseQuantity: "1.000000",
        lineCost: "0.2500",
      });
    }
  });
});
