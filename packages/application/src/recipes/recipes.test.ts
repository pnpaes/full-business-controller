import { DomainError, type UnitDimension } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { computeRecipeCost } from "./compute-recipe-cost";
import { loadRecipeVersionAsOf } from "./load-recipe-version";
import { registerAllergen } from "./register-allergen";
import { registerRecipe } from "./register-recipe";
import { registerRecipeVersion } from "./register-recipe-version";
import { FakeRecipeStore } from "./test-support";

const ORG = "org-1";
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
  store.items.set(id, { id, organizationId: ORG, code: id, name: id, baseUnitId, currentCost });
  return id;
}

function makeRecipe(store: FakeRecipeStore, id: string, name: string, outputItemId: string | null) {
  store.recipes.set(id, { id, organizationId: ORG, code: name.toUpperCase(), name, outputItemId });
  return id;
}

function makeVersion(
  store: FakeRecipeStore,
  id: string,
  recipeId: string,
  overrides: Partial<{
    state: string;
    plannedInputQty: string;
    plannedOutputQty: string;
    approvedUsableOutput: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }> = {},
) {
  store.versions.push({
    id,
    recipeId,
    versionNo: store.versions.filter((v) => v.recipeId === recipeId).length + 1,
    state: overrides.state ?? "approved",
    plannedInputQty: overrides.plannedInputQty ?? "1.000000",
    plannedOutputQty: overrides.plannedOutputQty ?? "1.000000",
    approvedUsableOutput: overrides.approvedUsableOutput ?? "1.000000",
    yieldRate: "1.000000",
    preparationMinutes: null,
    effectiveFrom: overrides.effectiveFrom ?? JAN,
    effectiveTo: overrides.effectiveTo ?? null,
    approvedBy: ACTOR,
    approvedAt: JAN,
    notes: null,
  });
  const version = store.versions[store.versions.length - 1]!;
  return version.id;
}

function addConversion(
  store: FakeRecipeStore,
  fromUnitId: string,
  toUnitId: string,
  factor: string,
  itemId: string | null = null,
) {
  const from = store.units.get(fromUnitId)!;
  const to = store.units.get(toUnitId)!;
  store.addConversion({
    fromUnit: { ...from },
    toUnit: { ...to },
    factor,
    itemId,
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    effectiveTo: null,
  });
}

describe("registerRecipe / registerAllergen", () => {
  it("registers a recipe and rejects a duplicate code", async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await registerRecipe(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "DOUGH",
      name: "Dough",
    });
    expect(recipeId).toBe("recipe-1");
    await expect(
      registerRecipe(store, { organizationId: ORG, actorId: ACTOR, code: "DOUGH", name: "Other" }),
    ).rejects.toThrow(/already registered/);
  });

  it("registers an allergen and rejects a duplicate code", async () => {
    const store = new FakeRecipeStore();
    await registerAllergen(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "GLUTEN",
      name: "Gluten",
      isDerived: true,
    });
    await expect(
      registerAllergen(store, { organizationId: ORG, actorId: ACTOR, code: "GLUTEN", name: "x" }),
    ).rejects.toThrow(/already registered/);
  });
});

describe("registerRecipeVersion", () => {
  async function seeded() {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-dough", g);
    const flour = makeItem(store, "item-flour", g);
    const { recipeId } = await registerRecipe(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "DOUGH",
      name: "Dough",
      outputItemId: "item-dough",
    });
    return { store, recipeId, g, flour };
  }

  it("derives yield_rate, stores lines and allergens, and audits", async () => {
    const { store, recipeId, g, flour } = await seeded();
    const gluten = (
      await registerAllergen(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "GLUTEN",
        name: "Gluten",
      })
    ).allergenId;

    const result = await registerRecipeVersion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId,
      versionNo: 1,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.800000",
      effectiveFrom: JAN,
      lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0.500000", unitId: g }],
      allergens: [{ allergenId: gluten, source: "derived" }],
    });

    expect(result.yieldRate).toBe("0.800000");
    expect(result.lineCount).toBe(1);
    expect(result.allergenCount).toBe(1);
    const version = await store.findRecipeVersion(result.recipeVersionId);
    expect(version).toMatchObject({ state: "draft", yieldRate: "0.800000" });
    expect(await store.listRecipeLines(result.recipeVersionId)).toHaveLength(1);
    expect(await store.listRecipeAllergens(result.recipeVersionId)).toEqual([
      {
        allergenId: gluten,
        code: "GLUTEN",
        name: "Gluten",
        isDerived: false,
        source: "derived",
        verifiedBy: null,
      },
    ]);
    expect(store.audits.at(-1)?.action).toBe("recipes.recipe_version.registered");
  });

  it("rejects a yield above 1 (approvedUsableOutput > plannedInputQty)", async () => {
    const { store, recipeId, g, flour } = await seeded();
    await expect(
      registerRecipeVersion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        recipeId,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.500000",
        effectiveFrom: JAN,
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0.500000", unitId: g }],
      }),
    ).rejects.toThrow(/must not exceed 1/);
  });

  it("rejects a non-positive quantity and an incompatible unit", async () => {
    const { store, recipeId, g, flour } = await seeded();
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId,
      versionNo: 1,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.800000",
      effectiveFrom: JAN,
    };
    await expect(
      registerRecipeVersion(store, {
        ...base,
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "0", unitId: g }],
      }),
    ).rejects.toThrow(/quantity must be positive/);

    // A time unit cannot convert to the item's mass base unit.
    const seconds = makeUnit(store, "sec", "time", false);
    await expect(
      registerRecipeVersion(store, {
        ...base,
        lines: [{ componentKind: "ingredient", itemId: flour, quantity: "1", unitId: seconds }],
      }),
    ).rejects.toThrow(/incompatible unit dimensions/);
  });

  it("rejects a direct self-reference and a mutual recursion", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-a", g);
    makeItem(store, "item-b", g);
    const a = (
      await registerRecipe(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "A",
        name: "A",
        outputItemId: "item-a",
      })
    ).recipeId;
    const b = (
      await registerRecipe(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "B",
        name: "B",
        outputItemId: "item-b",
      })
    ).recipeId;

    await expect(
      registerRecipeVersion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        recipeId: a,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: JAN,
        lines: [{ componentKind: "sub_recipe", subRecipeId: a, quantity: "1", unitId: g }],
      }),
    ).rejects.toThrow(/must not contain itself/);

    // A depends on B…
    await registerRecipeVersion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId: a,
      versionNo: 1,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "1.000000",
      effectiveFrom: JAN,
      lines: [{ componentKind: "sub_recipe", subRecipeId: b, quantity: "1", unitId: g }],
    });
    // … registering B depending on A closes the cycle.
    await expect(
      registerRecipeVersion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        recipeId: b,
        versionNo: 1,
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: JAN,
        lines: [{ componentKind: "sub_recipe", subRecipeId: a, quantity: "1", unitId: g }],
      }),
    ).rejects.toThrow(/circular sub-recipes/);
  });

  it("rejects a verified allergen without a verifier and a duplicate declaration", async () => {
    const { store, recipeId, g, flour } = await seeded();
    const gluten = (
      await registerAllergen(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "GLUTEN",
        name: "Gluten",
      })
    ).allergenId;
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId,
      versionNo: 1,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.800000",
      effectiveFrom: JAN,
      lines: [
        { componentKind: "ingredient" as const, itemId: flour, quantity: "0.500000", unitId: g },
      ],
    };
    await expect(
      registerRecipeVersion(store, {
        ...base,
        allergens: [{ allergenId: gluten, source: "verified" }],
      }),
    ).rejects.toThrow(/requires verifiedBy/);
    await expect(
      registerRecipeVersion(store, {
        ...base,
        allergens: [
          { allergenId: gluten, source: "derived" },
          { allergenId: gluten, source: "derived" },
        ],
      }),
    ).rejects.toThrow(/at most once/);
  });

  it("rejects an approved version whose sub-recipe has no approved version (COST-002)", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-a", g);
    makeItem(store, "item-c", g);
    const a = (
      await registerRecipe(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "A",
        name: "A",
        outputItemId: "item-a",
      })
    ).recipeId;
    const c = (
      await registerRecipe(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "C",
        name: "C",
        outputItemId: "item-c",
      })
    ).recipeId;
    // Only a draft version of C exists.
    makeVersion(store, "c-v1", c, { state: "draft" });
    await expect(
      registerRecipeVersion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        recipeId: a,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1.000000",
        plannedOutputQty: "1.000000",
        approvedUsableOutput: "1.000000",
        effectiveFrom: JAN,
        approvedBy: ACTOR,
        lines: [{ componentKind: "sub_recipe", subRecipeId: c, quantity: "1", unitId: g }],
      }),
    ).rejects.toThrow(/without an approved version/);
  });
});

describe("loadRecipeVersionAsOf", () => {
  it("returns the version effective at the date and rejects none / overlapping", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-a", g);
    const a = makeRecipe(store, "recipe-a", "A", "item-a");
    makeVersion(store, "v1", a, { effectiveFrom: JAN });

    const loaded = await loadRecipeVersionAsOf(store, {
      organizationId: ORG,
      recipeId: a,
      asOf: JUN,
    });
    expect(loaded.version.id).toBe("v1");
    await expect(
      loadRecipeVersionAsOf(store, {
        organizationId: ORG,
        recipeId: a,
        asOf: new Date("2025-12-31T00:00:00Z"),
      }),
    ).rejects.toThrow(/no recipe version is effective/);

    // An overlapping window is a data-integrity failure, not a silent pick.
    makeVersion(store, "v2", a, { effectiveFrom: new Date("2026-03-01T00:00:00Z") });
    await expect(
      loadRecipeVersionAsOf(store, { organizationId: ORG, recipeId: a, asOf: JUN }),
    ).rejects.toThrow(/more than one recipe version/);
  });
});

describe("computeRecipeCost (§6)", () => {
  function costedStore() {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const kg = makeUnit(store, "kg", "mass", false);
    addConversion(store, kg, g, "1000.000000");
    makeItem(store, "item-pizza", g);
    makeItem(store, "item-flour", g);
    store.supplierPrices.set("item-flour", [
      { cost: "0.2000", effectiveFrom: new Date("2025-01-01T00:00:00Z") },
    ]);
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const version = makeVersion(store, "pizza-v1", pizza, {
      plannedInputQty: "1.000000",
      approvedUsableOutput: "0.800000",
    });
    return { store, g, kg, pizza, version };
  }

  it("applies loss, yield (B0) and cost (B2), then divides by output (B3)", async () => {
    const { store, g, version } = costedStore();
    store.lines.push({
      id: "line-1",
      recipeVersionId: version,
      componentKind: "ingredient",
      itemId: "item-flour",
      subRecipeId: null,
      quantity: "0.800000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });

    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: version,
      asOf: JUN,
    });
    // required = 0.8 / 0.8 = 1.000000; line = 1 × 0.2 = 0.2000; per unit = 0.2 / 0.8.
    expect(cost.components[0]).toMatchObject({
      requiredPurchaseQuantity: "1.000000",
      unitCost: "0.2000",
      lineCost: "0.2000",
      sourceType: "supplier_price",
    });
    expect(cost.recipeInputCost).toBe("0.2000");
    expect(cost.costPerUsableOutputUnit).toBe("0.2500");
  });

  it("converts a line quantity into the item base unit before costing", async () => {
    const { store, kg, version } = costedStore();
    store.lines.push({
      id: "line-1",
      recipeVersionId: version,
      componentKind: "ingredient",
      itemId: "item-flour",
      subRecipeId: null,
      quantity: "0.000800", // kg
      unitId: kg,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: version,
      asOf: JUN,
    });
    expect(cost.components[0]!.requiredPurchaseQuantity).toBe("1.000000");
    expect(cost.components[0]!.lineCost).toBe("0.2000");
  });

  it("composes a sub-recipe bottom-up", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-sauce", g);
    makeItem(store, "item-tomato", g);
    makeItem(store, "item-pizza", g);
    store.supplierPrices.set("item-tomato", [
      { cost: "0.1000", effectiveFrom: new Date("2025-01-01T00:00:00Z") },
    ]);
    const sauce = makeRecipe(store, "recipe-sauce", "Sauce", "item-sauce");
    const sauceV1 = makeVersion(store, "sauce-v1", sauce, { approvedUsableOutput: "1.000000" });
    store.lines.push({
      id: "sauce-line-1",
      recipeVersionId: sauceV1,
      componentKind: "ingredient",
      itemId: "item-tomato",
      subRecipeId: null,
      quantity: "0.500000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const pizzaV1 = makeVersion(store, "pizza-v1", pizza, { approvedUsableOutput: "1.000000" });
    store.lines.push({
      id: "pizza-line-1",
      recipeVersionId: pizzaV1,
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: sauce,
      quantity: "0.300000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });

    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: pizzaV1,
      asOf: JUN,
    });
    // Sauce: 0.5 g × 0.1 = 0.0500 per 1 g output → 0.0500.
    // Pizza: 0.3 × 0.0500 = 0.0150.
    expect(cost.components[0]).toMatchObject({
      sourceType: "sub_recipe",
      childRecipeVersionId: sauceV1,
      unitCost: "0.0500",
      lineCost: "0.0150",
    });
    expect(cost.costPerUsableOutputUnit).toBe("0.0150");
  });

  it("rejects a sub-recipe without an approved effective version", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-sauce", g);
    makeItem(store, "item-pizza", g);
    const sauce = makeRecipe(store, "recipe-sauce", "Sauce", "item-sauce");
    makeVersion(store, "sauce-v1", sauce, { state: "draft" });
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const pizzaV1 = makeVersion(store, "pizza-v1", pizza);
    store.lines.push({
      id: "pizza-line-1",
      recipeVersionId: pizzaV1,
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: sauce,
      quantity: "0.300000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    await expect(
      computeRecipeCost(store, { organizationId: ORG, recipeVersionId: pizzaV1, asOf: JUN }),
    ).rejects.toThrow(/no approved version/);
  });

  it("uses observation then current_cost when no supplier price exists", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-pizza", g);
    makeItem(store, "item-salt", g, "7.0000");
    store.observations.set("item-salt", [
      {
        id: "o1",
        packPrice: "100.0000",
        packSize: "1000.000000",
        packUnitId: g,
        observedAt: "2025-06-01",
      },
    ]);
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const version = makeVersion(store, "pizza-v1", pizza);
    store.lines.push({
      id: "line-1",
      recipeVersionId: version,
      componentKind: "ingredient",
      itemId: "item-salt",
      subRecipeId: null,
      quantity: "1.000000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: version,
      asOf: JUN,
    });
    expect(cost.components[0]).toMatchObject({
      sourceType: "cost_observation",
      unitCost: "0.1000",
    });

    store.observations.set("item-salt", []);
    const fallback = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: version,
      asOf: JUN,
    });
    expect(fallback.components[0]).toMatchObject({
      sourceType: "current_cost",
      unitCost: "7.0000",
    });
  });

  it("rejects a recipe version from another organization", async () => {
    const { store, version } = costedStore();
    await expect(
      computeRecipeCost(store, { organizationId: "org-2", recipeVersionId: version, asOf: JUN }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects a non-approved version id (COST-002)", async () => {
    const { store, g, pizza } = costedStore();
    store.lines.push({
      id: "line-draft",
      recipeVersionId: "pizza-draft",
      componentKind: "ingredient",
      itemId: "item-flour",
      subRecipeId: null,
      quantity: "0.800000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const draft = makeVersion(store, "pizza-draft", pizza, { state: "draft" });
    await expect(
      computeRecipeCost(store, { organizationId: ORG, recipeVersionId: draft, asOf: JUN }),
    ).rejects.toThrow(/must be approved to cost/);
  });

  it("normalises an observation pack unit through the conversion graph", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const kg = makeUnit(store, "kg", "mass", false);
    addConversion(store, kg, g, "1000.000000");
    makeItem(store, "item-pizza", g);
    makeItem(store, "item-salt", g);
    // A 1 kg pack at 100.0000 must become 0.1000 per gram, not per kilogram.
    store.observations.set("item-salt", [
      {
        id: "o1",
        packPrice: "100.0000",
        packSize: "1.000000",
        packUnitId: kg,
        observedAt: "2025-06-01",
      },
    ]);
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const version = makeVersion(store, "pizza-v1", pizza);
    store.lines.push({
      id: "line-1",
      recipeVersionId: version,
      componentKind: "ingredient",
      itemId: "item-salt",
      subRecipeId: null,
      quantity: "1.000000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: version,
      asOf: JUN,
    });
    expect(cost.components[0]).toMatchObject({
      sourceType: "cost_observation",
      unitCost: "0.1000",
      lineCost: "0.1000",
    });
  });

  it("converts a parent sub-recipe line from kg into the child's gram base unit", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    const kg = makeUnit(store, "kg", "mass", false);
    addConversion(store, kg, g, "1000.000000");
    makeItem(store, "item-sauce", g);
    makeItem(store, "item-tomato", g);
    makeItem(store, "item-pizza", g);
    store.supplierPrices.set("item-tomato", [
      { cost: "0.1000", effectiveFrom: new Date("2025-01-01T00:00:00Z") },
    ]);
    const sauce = makeRecipe(store, "recipe-sauce", "Sauce", "item-sauce");
    const sauceV1 = makeVersion(store, "sauce-v1", sauce, { approvedUsableOutput: "1.000000" });
    store.lines.push({
      id: "sauce-line-1",
      recipeVersionId: sauceV1,
      componentKind: "ingredient",
      itemId: "item-tomato",
      subRecipeId: null,
      quantity: "0.500000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    const pizza = makeRecipe(store, "recipe-pizza", "Pizza", "item-pizza");
    const pizzaV1 = makeVersion(store, "pizza-v1", pizza, { approvedUsableOutput: "1.000000" });
    // The parent line is in kg while the child's base unit is g.
    store.lines.push({
      id: "pizza-line-1",
      recipeVersionId: pizzaV1,
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: sauce,
      quantity: "0.003000", // 3 g
      unitId: kg,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });

    const cost = await computeRecipeCost(store, {
      organizationId: ORG,
      recipeVersionId: pizzaV1,
      asOf: JUN,
    });
    // Sauce: 0.5 g × 0.1 = 0.0500 per 1 g; pizza: 3 g × 0.0500 = 0.1500.
    expect(cost.components[0]).toMatchObject({
      sourceType: "sub_recipe",
      unitId: g,
      requiredPurchaseQuantity: "3.000000",
      lineCost: "0.1500",
    });
  });

  it("rejects a cycle inserted into the store defensively (COST-002)", async () => {
    const store = new FakeRecipeStore();
    const g = makeUnit(store, "g", "mass", true);
    makeItem(store, "item-a", g);
    makeItem(store, "item-b", g);
    const a = makeRecipe(store, "recipe-a", "A", "item-a");
    const b = makeRecipe(store, "recipe-b", "B", "item-b");
    const aV1 = makeVersion(store, "a-v1", a);
    const bV1 = makeVersion(store, "b-v1", b);
    // Registration would reject this; the store is seeded directly to prove
    // costing refuses to recurse forever on bad data.
    store.lines.push({
      id: "a-line-1",
      recipeVersionId: aV1,
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: b,
      quantity: "1.000000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    store.lines.push({
      id: "b-line-1",
      recipeVersionId: bV1,
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: a,
      quantity: "1.000000",
      unitId: g,
      lossFactor: "1.000000",
      stage: null,
      substitutionGroup: null,
    });
    await expect(
      computeRecipeCost(store, { organizationId: ORG, recipeVersionId: aV1, asOf: JUN }),
    ).rejects.toThrow(/circular sub-recipes/);
  });
});
