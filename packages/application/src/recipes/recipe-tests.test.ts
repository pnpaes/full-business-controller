import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { listRecipeTests, recordRecipeTest, type RecordRecipeTestInput } from "./recipe-tests";
import { registerRecipe } from "./register-recipe";
import { registerRecipeVersion, type RegisterRecipeVersionInput } from "./register-recipe-version";
import { FakeRecipeStore } from "./test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";
const JAN = new Date("2026-01-01T00:00:00Z");
const FEB = new Date("2026-02-01T00:00:00Z");
const MAR = new Date("2026-03-01T00:00:00Z");

function makeVersion(
  store: FakeRecipeStore,
  id: string,
  recipeId: string,
  overrides: Partial<{ versionNo: number; state: string }> = {},
) {
  store.versions.push({
    id,
    recipeId,
    versionNo: overrides.versionNo ?? 1,
    state: overrides.state ?? "approved",
    plannedInputQty: "1.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: "0.800000",
    yieldRate: "0.800000",
    preparationMinutes: null,
    laborCostCenterId: null,
    laborRoleCode: null,
    effectiveFrom: JAN,
    effectiveTo: null,
    approvedBy: ACTOR,
    approvedAt: JAN,
    notes: null,
    method: null,
  });
  return id;
}

function seeded() {
  const store = new FakeRecipeStore();
  store.recipes.set("recipe-1", {
    id: "recipe-1",
    organizationId: ORG,
    code: "DOUGH",
    name: "Dough",
    outputItemId: null,
  });
  makeVersion(store, "version-1", "recipe-1", { versionNo: 1 });
  makeVersion(store, "version-2", "recipe-1", { versionNo: 2, state: "draft" });
  return store;
}

function baseInput(overrides: Partial<RecordRecipeTestInput> = {}): RecordRecipeTestInput {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    recipeVersionId: "version-1",
    testedAt: FEB,
    batchInputQty: "2.000000",
    ...overrides,
  };
}

describe("recordRecipeTest", () => {
  it("records a trial and audits the append-only fact", async () => {
    const store = seeded();

    const result = await recordRecipeTest(store, {
      ...baseInput(),
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "nok",
      qualityComments: "  a little dry  ",
      proposedAdjustment: "  add 5% water  ",
    });

    const stored = await store.findRecipeTest(result.recipeTestId);
    expect(stored).toMatchObject({
      organizationId: ORG,
      recipeVersionId: "version-1",
      recipeId: "recipe-1",
      batchInputQty: "2.000000",
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "NOK",
      qualityComments: "a little dry",
      proposedAdjustment: "add 5% water",
      resultingRecipeVersionId: null,
      testedVersionNo: 1,
      testedVersionState: "approved",
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "recipes.recipe_test.recorded",
      entityType: "recipe_test",
      entityId: result.recipeTestId,
    });
  });

  it("stores absent optional fields as null and blank text as null", async () => {
    const store = seeded();

    const result = await recordRecipeTest(store, {
      ...baseInput(),
      qualityComments: "   ",
      currency: null,
    });

    const stored = await store.findRecipeTest(result.recipeTestId);
    expect(stored).toMatchObject({
      actualOutputQty: null,
      actualDurationMinutes: null,
      actualCost: null,
      currency: null,
      qualityComments: null,
      proposedAdjustment: null,
    });
  });

  it("rejects a version whose recipe is in another organization", async () => {
    const store = seeded();
    store.recipes.set("recipe-other", {
      id: "recipe-other",
      organizationId: OTHER_ORG,
      code: "OTHER",
      name: "Other",
      outputItemId: null,
    });
    makeVersion(store, "version-foreign", "recipe-other");

    await expect(
      recordRecipeTest(store, { ...baseInput({ recipeVersionId: "version-foreign" }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects an unknown version", async () => {
    const store = seeded();

    await expect(
      recordRecipeTest(store, { ...baseInput({ recipeVersionId: "missing" }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each<[string, Partial<RecordRecipeTestInput>]>([
    ["a zero batch input", { batchInputQty: "0" }],
    ["a negative batch input", { batchInputQty: "-1" }],
    ["a non-numeric batch input", { batchInputQty: "many" }],
    ["a zero actual output", { actualOutputQty: "0" }],
    ["a negative actual output", { actualOutputQty: "-0.5" }],
  ])("rejects %s", async (_label, overrides) => {
    const store = seeded();

    await expect(recordRecipeTest(store, baseInput(overrides))).rejects.toBeInstanceOf(DomainError);
  });

  it.each<[string, Partial<RecordRecipeTestInput>]>([
    ["a negative duration", { actualDurationMinutes: -1 }],
    ["a fractional duration", { actualDurationMinutes: 1.5 }],
    ["a negative cost", { actualCost: "-0.0001" }],
    ["a malformed currency", { currency: "NOKK" }],
  ])("rejects %s", async (_label, overrides) => {
    const store = seeded();

    await expect(recordRecipeTest(store, baseInput(overrides))).rejects.toBeInstanceOf(DomainError);
  });
});

describe("listRecipeTests", () => {
  it("lists a recipe's trials newest tested first", async () => {
    const store = seeded();
    await recordRecipeTest(store, { ...baseInput({ testedAt: JAN }) });
    await recordRecipeTest(store, { ...baseInput({ testedAt: MAR }) });
    await recordRecipeTest(store, { ...baseInput({ testedAt: FEB }) });

    const tests = await listRecipeTests(store, { organizationId: ORG, recipeId: "recipe-1" });

    expect(tests.map((test) => test.testedAt)).toEqual([MAR, FEB, JAN]);
    expect(tests.every((test) => test.recipeId === "recipe-1")).toBe(true);
  });

  it("scopes the list to one organization and one version", async () => {
    const store = seeded();
    store.recipes.set("recipe-other", {
      id: "recipe-other",
      organizationId: OTHER_ORG,
      code: "OTHER",
      name: "Other",
      outputItemId: null,
    });
    makeVersion(store, "version-other", "recipe-other");
    await recordRecipeTest(store, { ...baseInput({ testedAt: JAN }) });
    await recordRecipeTest(store, {
      ...baseInput({ recipeVersionId: "version-2", testedAt: FEB }),
    });
    await recordRecipeTest(store, {
      organizationId: OTHER_ORG,
      actorId: ACTOR,
      recipeVersionId: "version-other",
      testedAt: MAR,
      batchInputQty: "1.000000",
    });

    const byRecipe = await listRecipeTests(store, { organizationId: ORG, recipeId: "recipe-1" });
    expect(byRecipe).toHaveLength(2);

    const byVersion = await listRecipeTests(store, {
      organizationId: ORG,
      recipeVersionId: "version-1",
    });
    expect(byVersion).toHaveLength(1);
    expect(byVersion[0]!.recipeVersionId).toBe("version-1");
  });

  it("requires a scope", async () => {
    const store = seeded();
    await expect(listRecipeTests(store, { organizationId: ORG })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe("registerRecipeVersion sourceRecipeTestId", () => {
  async function seeded() {
    const store = new FakeRecipeStore();
    store.units.set("unit-g", { id: "unit-g", code: "g", dimension: "mass", isBase: true });
    store.items.set("item-flour", {
      id: "item-flour",
      organizationId: ORG,
      code: "FLOUR",
      name: "Flour",
      baseUnitId: "unit-g",
      currentCost: null,
    });
    store.items.set("item-dough", {
      id: "item-dough",
      organizationId: ORG,
      code: "DOUGH",
      name: "Dough",
      baseUnitId: "unit-g",
      currentCost: null,
    });
    const { recipeId } = await registerRecipe(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "DOUGH",
      name: "Dough",
      outputItemId: "item-dough",
    });
    const { recipeVersionId } = await registerRecipeVersion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId,
      versionNo: 1,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.800000",
      effectiveFrom: JAN,
      lines: [
        {
          componentKind: "ingredient",
          itemId: "item-flour",
          quantity: "0.800000",
          unitId: "unit-g",
        },
      ],
    });
    return { store, recipeId, recipeVersionId };
  }

  function registerFrom(
    store: FakeRecipeStore,
    recipeId: string,
    overrides: Partial<RegisterRecipeVersionInput>,
  ) {
    return registerRecipeVersion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeId,
      versionNo: 2,
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.800000",
      effectiveFrom: FEB,
      lines: [
        {
          componentKind: "ingredient",
          itemId: "item-flour",
          quantity: "0.800000",
          unitId: "unit-g",
        },
      ],
      ...overrides,
    });
  }

  it("links the trial it answers in the same command", async () => {
    const { store, recipeId, recipeVersionId } = await seeded();
    const { recipeTestId } = await recordRecipeTest(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeVersionId,
      testedAt: FEB,
      batchInputQty: "1.000000",
      proposedAdjustment: "more water",
    });

    const registered = await registerFrom(store, recipeId, { sourceRecipeTestId: recipeTestId });

    const test = await store.findRecipeTest(recipeTestId);
    expect(test?.resultingRecipeVersionId).toBe(registered.recipeVersionId);
    expect(test?.resultingVersionNo).toBe(2);
  });

  it("rejects a foreign-organization trial", async () => {
    const { store, recipeId, recipeVersionId } = await seeded();
    const { recipeTestId } = await recordRecipeTest(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeVersionId,
      testedAt: FEB,
      batchInputQty: "1.000000",
    });
    store.recipeTests.set(recipeTestId, {
      ...store.recipeTests.get(recipeTestId)!,
      organizationId: OTHER_ORG,
    });

    await expect(
      registerFrom(store, recipeId, { sourceRecipeTestId: recipeTestId }),
    ).rejects.toThrow(/not found in organization/);
  });

  it("rejects an already-linked trial", async () => {
    const { store, recipeId, recipeVersionId } = await seeded();
    const { recipeTestId } = await recordRecipeTest(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeVersionId,
      testedAt: FEB,
      batchInputQty: "1.000000",
    });
    await registerFrom(store, recipeId, { sourceRecipeTestId: recipeTestId });

    await expect(
      registerFrom(store, recipeId, { versionNo: 3, sourceRecipeTestId: recipeTestId }),
    ).rejects.toThrow(/already linked/);
  });

  it("rejects a trial of a different recipe", async () => {
    const { store, recipeVersionId } = await seeded();
    const { recipeTestId } = await recordRecipeTest(store, {
      organizationId: ORG,
      actorId: ACTOR,
      recipeVersionId,
      testedAt: FEB,
      batchInputQty: "1.000000",
    });
    store.recipes.set("recipe-2", {
      id: "recipe-2",
      organizationId: ORG,
      code: "SAUCE",
      name: "Sauce",
      outputItemId: null,
    });

    await expect(
      registerFrom(store, "recipe-2", { sourceRecipeTestId: recipeTestId }),
    ).rejects.toThrow(/different recipe/);
  });
});
