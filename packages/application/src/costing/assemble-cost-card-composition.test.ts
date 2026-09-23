import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeRecipeStore } from "../recipes/test-support";
import type { PriceVersionRecord } from "./price-scenario-types";
import {
  assembleCostCardComposition,
  type CostCardComponentStore,
} from "./assemble-cost-card-composition";
import { FakeCostingStore } from "./test-support";

const ORG = "org-1";
const VARIANT = "variant-1";
const LOCATION = "location-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");

/** `FakeRecipeStore` plus the effective price-version read and the `DEC-112` costing reads. */
class FakeCompositionStore extends FakeRecipeStore implements CostCardComponentStore {
  readonly priceVersions: PriceVersionRecord[] = [];
  readonly costing = new FakeCostingStore();
  eligibleProductCount = 0;

  findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
    readonly asOf: Date;
  }): Promise<PriceVersionRecord | undefined> {
    const match = this.priceVersions.find(
      (version) =>
        version.organizationId === query.organizationId &&
        version.productVariantId === query.productVariantId &&
        version.locationId === query.locationId &&
        version.channelId === query.channelId &&
        new Date(version.effectiveFrom).getTime() <= query.asOf.getTime() &&
        (version.effectiveTo === null ||
          query.asOf.getTime() < new Date(version.effectiveTo).getTime()),
    );
    return Promise.resolve(match);
  }

  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }) {
    return this.costing.findEffectiveLaborRate(query);
  }

  listEffectiveChannelFeeRules(query: {
    readonly organizationId: string;
    readonly channelId: string;
    readonly asOf: Date;
  }) {
    return this.costing.listEffectiveChannelFeeRules(query);
  }

  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string | null;
  }) {
    return this.costing.listEffectiveOperatingCosts(query);
  }

  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }) {
    return this.costing.listEffectiveAllocationRules(query);
  }

  countEligibleProducts(): Promise<number> {
    return Promise.resolve(this.eligibleProductCount);
  }

  sumSalesVolume(): Promise<{
    readonly revenue: string;
    readonly transactions: string;
    readonly units: string;
  }> {
    return Promise.resolve({ revenue: "0.0000", transactions: "0", units: "0.000000" });
  }
}

function priceVersion(overrides: Partial<PriceVersionRecord> = {}): PriceVersionRecord {
  return {
    id: "price-version-1",
    organizationId: ORG,
    productVariantId: VARIANT,
    locationId: LOCATION,
    channelId: null,
    grossPrice: "42.3900",
    netPrice: "33.9130",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    approvedBy: "approver-1",
    approvedAt: "2026-01-01T00:00:00.000Z",
    sourceScenarioId: "scenario-1",
    ...overrides,
  };
}

/**
 * Seeds a parent recipe (`dish`) with an ingredient, a packaging line and a
 * sub-recipe, plus the child recipe (`sauce`) with its own ingredient and
 * packaging lines, an effective assignment and an effective price version.
 *
 * Parent (output 1000):
 *   flour   500 g   @ 0.0100  -> 5.0000   (ingredient)
 *   box       1 ea  @ 0.2000  -> 0.2000   (packaging)
 *   sauce   100 g   @ 0.0101  -> 1.0100   (sub_recipe)
 * Child (output 1000):
 *   salt    200 g   @ 0.0500  -> 10.0000
 *   tub       1 ea  @ 0.1000  ->  0.1000  -> per unit 0.0101
 *
 * => ingredientCost = (5.0000 + 1.0100) / 1000 = 0.0060
 *    packagingCost  = 0.2000 / 1000            = 0.0002
 */
function seedStore(): {
  store: FakeCompositionStore;
  parentVersionId: string;
  childVersionId: string;
} {
  const store = new FakeCompositionStore();
  store.units.set("g", { id: "g", code: "g", dimension: "mass", isBase: true });
  store.units.set("ea", { id: "ea", code: "ea", dimension: "count", isBase: true });
  store.items.set("flour", {
    id: "flour",
    organizationId: ORG,
    code: "FLOUR",
    name: "Flour",
    baseUnitId: "g",
    currentCost: "0.0100",
  });
  store.items.set("box", {
    id: "box",
    organizationId: ORG,
    code: "BOX",
    name: "Box",
    baseUnitId: "ea",
    currentCost: "0.2000",
  });
  store.items.set("salt", {
    id: "salt",
    organizationId: ORG,
    code: "SALT",
    name: "Salt",
    baseUnitId: "g",
    currentCost: "0.0500",
  });
  store.items.set("tub", {
    id: "tub",
    organizationId: ORG,
    code: "TUB",
    name: "Tub",
    baseUnitId: "ea",
    currentCost: "0.1000",
  });
  store.items.set("sauce", {
    id: "sauce",
    organizationId: ORG,
    code: "SAUCE",
    name: "Sauce",
    baseUnitId: "g",
    currentCost: null,
  });

  store.recipes.set("recipe-sauce", {
    id: "recipe-sauce",
    organizationId: ORG,
    code: "SAUCE",
    name: "Sauce",
    outputItemId: "sauce",
  });
  store.recipes.set("recipe-dish", {
    id: "recipe-dish",
    organizationId: ORG,
    code: "DISH",
    name: "Dish",
    outputItemId: "dish",
  });

  store.versions.push(
    {
      id: "child-version-1",
      recipeId: "recipe-sauce",
      versionNo: 1,
      state: "approved",
      plannedInputQty: "1000",
      plannedOutputQty: "1000",
      approvedUsableOutput: "1000",
      yieldRate: "1.000000",
      preparationMinutes: null,
      laborCostCenterId: null,
      laborRoleCode: null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: null,
      approvedBy: "approver-1",
      approvedAt: new Date("2026-01-01T00:00:00Z"),
      notes: null,
    },
    {
      id: "parent-version-1",
      recipeId: "recipe-dish",
      versionNo: 1,
      state: "approved",
      plannedInputQty: "1000",
      plannedOutputQty: "1000",
      approvedUsableOutput: "1000",
      yieldRate: "1.000000",
      preparationMinutes: null,
      laborCostCenterId: null,
      laborRoleCode: null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: null,
      approvedBy: "approver-1",
      approvedAt: new Date("2026-01-01T00:00:00Z"),
      notes: null,
    },
  );

  store.lines.push(
    {
      id: "child-line-1",
      recipeVersionId: "child-version-1",
      componentKind: "ingredient",
      itemId: "salt",
      subRecipeId: null,
      quantity: "200",
      unitId: "g",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
    {
      id: "child-line-2",
      recipeVersionId: "child-version-1",
      componentKind: "packaging",
      itemId: "tub",
      subRecipeId: null,
      quantity: "1",
      unitId: "ea",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
    {
      id: "parent-line-1",
      recipeVersionId: "parent-version-1",
      componentKind: "ingredient",
      itemId: "flour",
      subRecipeId: null,
      quantity: "500",
      unitId: "g",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
    {
      id: "parent-line-2",
      recipeVersionId: "parent-version-1",
      componentKind: "packaging",
      itemId: "box",
      subRecipeId: null,
      quantity: "1",
      unitId: "ea",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
    {
      id: "parent-line-3",
      recipeVersionId: "parent-version-1",
      componentKind: "sub_recipe",
      itemId: null,
      subRecipeId: "recipe-sauce",
      quantity: "100",
      unitId: "g",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
  );

  store.addVariantRecipeAssignment({
    organizationId: ORG,
    productVariantId: VARIANT,
    locationId: LOCATION,
    recipeVersionId: "parent-version-1",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
  });
  store.priceVersions.push(priceVersion());

  return { store, parentVersionId: "parent-version-1", childVersionId: "child-version-1" };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    productVariantId: VARIANT,
    locationId: LOCATION,
    asOf: AS_OF,
    ...overrides,
  };
}

describe("assembleCostCardComposition", () => {
  let seeded: ReturnType<typeof seedStore>;

  beforeEach(() => {
    seeded = seedStore();
  });

  it("splits ingredient/packaging/sub-recipe and takes unitNetSales from the price version", async () => {
    const result = await assembleCostCardComposition(seeded.store, baseInput());

    expect(result.recipeVersionId).toBe(seeded.parentVersionId);
    expect(result.composition).toMatchObject({
      currency: "NOK",
      ingredientCost: "0.0060",
      packagingCost: "0.0002",
      unitNetSales: "33.9130",
      directLaborCost: "0.0000",
      channelVariableCost: "0.0000",
      otherVariableCost: "0.0000",
      allocatedUnitOverhead: "0.0000",
    });
    expect(result.provenance.assembled).toEqual({
      ingredientCost: "0.0060",
      packagingCost: "0.0002",
      unitNetSales: "33.9130",
    });
    expect(result.provenance.priceVersionId).toBe("price-version-1");
    expect(result.provenance.approvedUsableOutput).toBe("1000");
  });

  it("labels a sub-recipe component and keeps its internal packaging in the sub_recipe bucket", async () => {
    const result = await assembleCostCardComposition(seeded.store, baseInput());

    const subRecipe = result.components.find(
      (component) => component.provenance?.["recipeComponentKind"] === "sub_recipe",
    );
    expect(subRecipe).toBeDefined();
    expect(subRecipe?.componentKind).toBe("ingredient");
    expect(subRecipe?.amount).toBe("1.0100");
    expect(subRecipe?.provenance?.["sourceType"]).toBe("sub_recipe");
    expect(subRecipe?.provenance?.["childRecipeVersionId"]).toBe(seeded.childVersionId);

    // The child's own packaging (0.1000) is inside the sub-recipe line cost, so it
    // does not inflate the parent's packaging bucket (only the 0.2000 box does).
    expect(result.composition.packagingCost).toBe("0.0002");
  });

  it("accepts an explicit recipeVersionId that agrees with the assignment", async () => {
    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ recipeVersionId: seeded.parentVersionId }),
    );
    expect(result.recipeVersionId).toBe(seeded.parentVersionId);
  });

  it("rejects an explicit recipeVersionId that disagrees with the assignment", async () => {
    await expect(
      assembleCostCardComposition(seeded.store, baseInput({ recipeVersionId: "other-version" })),
    ).rejects.toThrow(/does not match the effective recipe assignment/);
  });

  it("accepts an explicit recipeVersionId when no assignment is effective (DEC-111)", async () => {
    seeded.store.variantRecipeAssignments.length = 0;

    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ recipeVersionId: seeded.parentVersionId }),
    );

    expect(result.recipeVersionId).toBe(seeded.parentVersionId);
    expect(result.composition.ingredientCost).toBe("0.0060");
  });

  it("rejects when neither an assignment nor an explicit recipeVersionId is present", async () => {
    seeded.store.variantRecipeAssignments.length = 0;

    await expect(assembleCostCardComposition(seeded.store, baseInput())).rejects.toThrow(
      /no product recipe assignment is effective/,
    );
  });

  it("rejects when no effective price version exists", async () => {
    seeded.store.priceVersions.length = 0;

    await expect(assembleCostCardComposition(seeded.store, baseInput())).rejects.toThrow(
      /no effective price version/,
    );
  });

  it("passes supplied explicit component inputs through and defaults the rest", async () => {
    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({
        directLaborCost: "2.5548",
        channelVariableCost: "0.5000",
        otherVariableCost: "0.1000",
        allocatedUnitOverhead: "1.0000",
      }),
    );

    expect(result.composition).toMatchObject({
      directLaborCost: "2.5548",
      channelVariableCost: "0.5000",
      otherVariableCost: "0.1000",
      allocatedUnitOverhead: "1.0000",
    });
    expect(result.provenance.supplied).toEqual({
      directLaborCost: "2.5548",
      channelVariableCost: "0.5000",
      otherVariableCost: "0.1000",
      allocatedUnitOverhead: "1.0000",
    });

    const suppliedKinds = result.components
      .filter((component) => component.provenance?.["sourceType"] === "command_input")
      .map((component) => component.componentKind)
      .sort();
    expect(suppliedKinds).toEqual([
      "allocated_overhead",
      "channel_variable",
      "direct_labor",
      "other_variable",
    ]);
  });

  it("canonicalises a supplied money input to 4 dp", async () => {
    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ directLaborCost: "2.5" }),
    );
    expect(result.composition.directLaborCost).toBe("2.5000");
  });

  it("echoes the snapshot options for the caller to persist", async () => {
    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ fxRateId: "fx-1", taxRuleSnapshot: { basis: "inclusive" } }),
    );
    expect(result.snapshotOptions).toEqual({
      fxRateId: "fx-1",
      taxRuleSnapshot: { basis: "inclusive" },
    });
    expect((await assembleCostCardComposition(seeded.store, baseInput())).snapshotOptions).toEqual(
      {},
    );
  });

  it("rejects a malformed explicit decimal", async () => {
    await expect(
      assembleCostCardComposition(seeded.store, baseInput({ directLaborCost: "not-a-number" })),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      assembleCostCardComposition(seeded.store, baseInput({ channelVariableCost: "1.23456" })),
    ).rejects.toThrow(/more than 4 decimal places/);
  });

  it("rejects a negative explicit decimal", async () => {
    await expect(
      assembleCostCardComposition(seeded.store, baseInput({ otherVariableCost: "-1.0000" })),
    ).rejects.toThrow(/otherVariableCost must not be negative/);
  });

  it("rejects a negative unitNetSales", async () => {
    seeded.store.priceVersions[0] = priceVersion({ netPrice: "-1.0000" });

    await expect(assembleCostCardComposition(seeded.store, baseInput())).rejects.toThrow(
      /unitNetSales must not be negative/,
    );
  });

  it("rejects a non-positive approvedUsableOutput", async () => {
    seeded.store.versions[1] = {
      ...seeded.store.versions[1]!,
      approvedUsableOutput: "0",
    };

    await expect(assembleCostCardComposition(seeded.store, baseInput())).rejects.toThrow(
      /approvedUsableOutput must be positive/,
    );
  });

  it("omits a zero supplied component from the snapshot components", async () => {
    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ directLaborCost: "0.0000" }),
    );

    expect(result.components.some((component) => component.componentKind === "direct_labor")).toBe(
      false,
    );
    expect(
      result.components.filter(
        (component) => component.provenance?.["sourceType"] === "command_input",
      ),
    ).toEqual([]);
  });

  it("labels the recipe component rounding boundaries per CALCULATION_CONTRACT §6", async () => {
    const result = await assembleCostCardComposition(seeded.store, baseInput());

    const ingredient = result.components.find(
      (component) => component.provenance?.["recipeComponentKind"] === "ingredient",
    );
    expect(ingredient?.roundingBoundary).toBe("B2");
    expect(ingredient?.provenance?.["roundingBoundaries"]).toEqual({
      quantity: "B0",
      amount: "B2",
      unitCost: "B3",
    });

    const subRecipe = result.components.find(
      (component) => component.provenance?.["recipeComponentKind"] === "sub_recipe",
    );
    expect(subRecipe?.roundingBoundary).toBe("B3");
  });

  it("fails closed on an unknown recipe componentKind", async () => {
    seeded.store.lines.push({
      id: "parent-line-mystery",
      recipeVersionId: "parent-version-1",
      componentKind: "mystery",
      itemId: "flour",
      subRecipeId: null,
      quantity: "1",
      unitId: "g",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    });

    await expect(assembleCostCardComposition(seeded.store, baseInput())).rejects.toThrow(
      /unknown recipe componentKind "mystery"/,
    );
  });

  it("resolves a channel fee over the explicit channel variable cost (DEC-112)", async () => {
    seeded.store.priceVersions[0] = priceVersion({ channelId: "chan-1" });
    seeded.store.costing.channelFeeRules.push({
      id: "fee-1",
      organizationId: ORG,
      channelId: "chan-1",
      feeKind: "commission_pct",
      percentageRate: "0.100000",
      fixedAmount: null,
      feeBasis: "net_price",
      taxRuleId: null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: null,
    });

    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ channelId: "chan-1", channelVariableCost: "9.9999" }),
    );

    // 10% of netPrice 33.9130 = 3.3913.
    expect(result.composition.channelVariableCost).toBe("3.3913");
    expect(result.provenance.supplied.channelVariableCost).toBe("3.3913");
    expect(result.provenance.resolved?.channelVariableCost).toBe(true);
    const component = result.components.find(
      (candidate) => candidate.componentKind === "channel_variable",
    );
    expect(component?.amount).toBe("3.3913");
    expect(component?.provenance?.["sourceType"]).toBe("channel_fee_rule");
  });

  it("resolves direct labour from the recipe labour mapping over the explicit input (DEC-112)", async () => {
    seeded.store.versions[1] = {
      ...seeded.store.versions[1]!,
      preparationMinutes: 30,
      laborCostCenterId: "cc-1",
      laborRoleCode: "kitchen",
    };
    seeded.store.costing.laborRates.push({
      id: "rate-1",
      organizationId: ORG,
      costCenterId: "cc-1",
      roleCode: "kitchen",
      loadedHourlyRate: "306.57",
      productiveHoursPct: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });

    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ directLaborCost: "9.9999" }),
    );

    // 30 min / 60 × 306.57 / 1000 = 0.153285 -> 0.1533 (B3 HALF_UP).
    expect(result.composition.directLaborCost).toBe("0.1533");
    expect(result.provenance.resolved?.directLaborCost).toBe(true);
    const component = result.components.find(
      (candidate) => candidate.componentKind === "direct_labor",
    );
    expect(component?.amount).toBe("0.1533");
    expect(component?.provenance?.["sourceType"]).toBe("recipe_labour_rule");
  });

  it("resolves allocated overhead from the operating-cost pool over the explicit input (DEC-112)", async () => {
    seeded.store.costing.costPools.set("pool-1", {
      id: "pool-1",
      organizationId: ORG,
      code: "OVERHEAD",
      name: "Overhead",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    seeded.store.costing.operatingCosts.push({
      id: "oc-1",
      organizationId: ORG,
      locationId: null,
      costCenterId: "cc-1",
      costPoolId: "pool-1",
      amount: "1200.0000",
      currency: "NOK",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      vendor: null,
      evidenceFileId: null,
    });
    seeded.store.costing.allocationRules.push({
      id: "rule-1",
      costPoolId: "pool-1",
      driver: "eligible_products",
      scopeType: "location",
      denominatorSource: "eligible_products",
      fallbackBehavior: "stop",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    seeded.store.eligibleProductCount = 2;

    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ costPoolId: "pool-1", allocatedUnitOverhead: "9.9999" }),
    );

    // 1200.0000 / 2 = 600.0000.
    expect(result.composition.allocatedUnitOverhead).toBe("600.0000");
    expect(result.provenance.resolved?.allocatedUnitOverhead).toBe(true);
    const component = result.components.find(
      (candidate) => candidate.componentKind === "allocated_overhead",
    );
    expect(component?.amount).toBe("600.0000");
    expect(component?.provenance?.["sourceType"]).toBe("operating_cost_pool");
  });

  it("keeps the explicit input when a resolver has nothing to resolve (DEC-112)", async () => {
    // A channel is supplied but no fee rule is effective for it.
    seeded.store.priceVersions[0] = priceVersion({ channelId: "chan-1" });

    const result = await assembleCostCardComposition(
      seeded.store,
      baseInput({ channelId: "chan-1", channelVariableCost: "0.5000" }),
    );

    expect(result.composition.channelVariableCost).toBe("0.5000");
    expect(result.provenance.resolved?.channelVariableCost).toBe(false);
    expect(result.provenance.resolved?.directLaborCost).toBe(false);
    expect(result.provenance.resolved?.allocatedUnitOverhead).toBe(false);
  });
});
