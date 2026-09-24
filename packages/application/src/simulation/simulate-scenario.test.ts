import { describe, expect, it } from "vitest";

import { FakeCostingStore } from "../costing/test-support";
import type { PriceVersionRecord } from "../costing/price-scenario-types";
import type { CostCardComponentStore } from "../costing/assemble-cost-card-composition";
import type { SalesGroupRow, SalesSummary } from "../reporting/types";
import { FakeRecipeStore } from "../recipes/test-support";

import { simulateScenario } from "./simulate-scenario";
import type { SimulationScenario, SimulationStore } from "./types";

const ORG = "org-1";
const LOCATION = "location-1";
const VARIANT = "variant-1";
const VARIANT_SAUCE = "variant-sauce";
const AS_OF = "2026-06-01T00:00:00.000Z";
const FROM = "2026-05-01T00:00:00.000Z";
const TO = "2026-05-31T23:59:59.000Z";

/**
 * `FakeRecipeStore` plus the effective price version, the `DEC-112` costing
 * reads, `summarizeSales` and the variant-for-recipe read — the simulation's
 * full port.
 */
class FakeSimulationStore
  extends FakeRecipeStore
  implements SimulationStore, CostCardComponentStore
{
  readonly priceVersions: PriceVersionRecord[] = [];
  readonly costing = new FakeCostingStore();
  readonly assignments: { recipeVersionId: string; productVariantId: string }[] = [];
  summary: SalesSummary = { rows: [], transactions: 0 };

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
    return Promise.resolve(0);
  }

  sumSalesVolume(): Promise<{
    readonly revenue: string;
    readonly transactions: string;
    readonly units: string;
  }> {
    return Promise.resolve({ revenue: "0.0000", transactions: "0", units: "0.000000" });
  }

  summarizeSales(): Promise<SalesSummary> {
    return Promise.resolve(this.summary);
  }

  findVariantForRecipeVersion(query: {
    readonly organizationId: string;
    readonly recipeVersionId: string;
    readonly locationId: string;
    readonly asOf: Date;
  }): Promise<{ readonly productVariantId: string } | undefined> {
    const match = this.assignments.find(
      (assignment) => assignment.recipeVersionId === query.recipeVersionId,
    );
    return Promise.resolve(
      match === undefined ? undefined : { productVariantId: match.productVariantId },
    );
  }
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "parent-version-1",
    recipeId: "recipe-dish",
    versionNo: 1,
    state: "approved",
    plannedInputQty: "100",
    plannedOutputQty: "100",
    approvedUsableOutput: "100",
    yieldRate: "1.000000",
    preparationMinutes: 60,
    laborCostCenterId: "cc-1",
    laborRoleCode: "kitchen",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    approvedBy: "approver-1",
    approvedAt: new Date("2026-01-01T00:00:00Z"),
    notes: null,
    method: null,
    ...overrides,
  };
}

function priceVersion(overrides: Partial<PriceVersionRecord> = {}): PriceVersionRecord {
  return {
    id: "price-version-1",
    organizationId: ORG,
    productVariantId: VARIANT,
    locationId: LOCATION,
    channelId: null,
    grossPrice: "12.5000",
    netPrice: "10.0000",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    approvedBy: "approver-1",
    approvedAt: "2026-01-01T00:00:00.000Z",
    sourceScenarioId: "scenario-1",
    ...overrides,
  };
}

function groupRow(overrides: Partial<SalesGroupRow> = {}): SalesGroupRow {
  return {
    key: VARIANT,
    label: "Dish",
    locationId: LOCATION,
    channelId: null,
    category: "Mains",
    productVariantId: VARIANT,
    productKind: "menu_item",
    optionKinds: ["standalone"],
    periodBucket: "2026-05",
    transactions: 1,
    units: "100.000000",
    grossSales: "1250.0000",
    netSales: "1000.0000",
    taxAmount: "250.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "10.0000",
    ...overrides,
  };
}

/**
 * One dish: output 100, prep 60 min at 120.00/h, flour 100 g @ 0.1000,
 * packaging 1 ea @ 0.5000, net price 10.0000.
 *
 * ingredientCost = 10.0000 / 100 = 0.1000
 * packagingCost  =  0.5000 / 100 = 0.0050
 * directLabor    = 60/60 × 120.00 / 100 = 1.2000
 * unitCost       = 1.3050
 * baseline       = 100 units × 10.0000 = 1000.0000 revenue, × 1.3050 = 130.5000 cost
 */
function seed(): FakeSimulationStore {
  const store = new FakeSimulationStore();
  store.units.set("g", { id: "g", code: "g", dimension: "mass", isBase: true });
  store.units.set("ea", { id: "ea", code: "ea", dimension: "count", isBase: true });
  store.items.set("flour", {
    id: "flour",
    organizationId: ORG,
    code: "FLOUR",
    name: "Flour",
    baseUnitId: "g",
    currentCost: "0.1000",
  });
  store.items.set("box", {
    id: "box",
    organizationId: ORG,
    code: "BOX",
    name: "Box",
    baseUnitId: "ea",
    currentCost: "0.5000",
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
  store.recipes.set("recipe-dish", {
    id: "recipe-dish",
    organizationId: ORG,
    code: "DISH",
    name: "Dish",
    outputItemId: "flour",
  });
  store.recipes.set("recipe-sauce", {
    id: "recipe-sauce",
    organizationId: ORG,
    code: "SAUCE",
    name: "Sauce",
    outputItemId: "salt",
  });

  store.versions.push(version());
  store.versions.push(
    version({
      id: "sauce-version-1",
      recipeId: "recipe-sauce",
      preparationMinutes: null,
      laborCostCenterId: null,
      laborRoleCode: null,
    }),
  );
  store.lines.push(
    {
      id: "dish-line-1",
      recipeVersionId: "parent-version-1",
      componentKind: "ingredient",
      itemId: "flour",
      subRecipeId: null,
      quantity: "100",
      unitId: "g",
      lossFactor: "1",
      stage: null,
      substitutionGroup: null,
    },
    {
      id: "dish-line-2",
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
      id: "sauce-line-1",
      recipeVersionId: "sauce-version-1",
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
      id: "sauce-line-2",
      recipeVersionId: "sauce-version-1",
      componentKind: "packaging",
      itemId: "tub",
      subRecipeId: null,
      quantity: "1",
      unitId: "ea",
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
  store.assignments.push({ recipeVersionId: "sauce-version-1", productVariantId: VARIANT_SAUCE });
  store.priceVersions.push(priceVersion());
  store.priceVersions.push(
    priceVersion({
      id: "price-version-sauce",
      productVariantId: VARIANT_SAUCE,
      netPrice: "8.0000",
    }),
  );
  store.costing.laborRates.push({
    id: "rate-1",
    organizationId: ORG,
    costCenterId: "cc-1",
    roleCode: "kitchen",
    loadedHourlyRate: "120.00",
    productiveHoursPct: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  store.summary = { rows: [groupRow()], transactions: 1 };
  return store;
}

function scenario(overrides: Partial<SimulationScenario> = {}): SimulationScenario {
  return {
    organizationId: ORG,
    asOf: AS_OF,
    locationId: LOCATION,
    baseline: { periodFrom: FROM, periodTo: TO },
    ...overrides,
  };
}

describe("simulateScenario", () => {
  it("models the baseline from the cost chain and the effective price version", async () => {
    const store = seed();

    const result = await simulateScenario(store, scenario());

    expect(result.baselineRevenue).toBe("1000.0000");
    expect(result.baselineCost).toBe("130.5000");
    expect(result.baselineContribution).toBe("869.5000");
    expect(result.baselinePostedNetSales).toBe("1000.0000");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      kind: "baseline",
      baselineUnits: "100.000000",
      scenarioUnits: "100.000000",
      baselineUnitPrice: "10.0000",
      unitCost: "1.3050",
      recipeId: "recipe-dish",
    });
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.provenance.some((line) => line.includes("summarizeSales"))).toBe(true);
  });

  it("scales volume up and down", async () => {
    const up = await simulateScenario(seed(), scenario({ volumeChangePct: "10" }));
    expect(up.scenarioRevenue).toBe("1100.0000");
    expect(up.scenarioCost).toBe("143.5500");
    expect(up.deltas.contribution.absolute).toBe("86.9500");

    const down = await simulateScenario(seed(), scenario({ volumeChangePct: "-20" }));
    expect(down.scenarioRevenue).toBe("800.0000");
    expect(down.scenarioCost).toBe("104.4000");
    expect(down.lines[0]?.scenarioUnits).toBe("80.000000");
  });

  it("scales the net price on the volume", async () => {
    const result = await simulateScenario(seed(), scenario({ priceChangePct: "10" }));

    expect(result.scenarioRevenue).toBe("1100.0000");
    expect(result.scenarioCost).toBe("130.5000");
    expect(result.scenarioContribution).toBe("969.5000");
    expect(result.lines[0]?.scenarioUnitPrice).toBe("11.0000");
  });

  it("removes a menu item's contribution", async () => {
    const result = await simulateScenario(
      seed(),
      scenario({ menuRemovals: [{ recipeId: "recipe-dish" }] }),
    );

    expect(result.baselineContribution).toBe("869.5000");
    expect(result.scenarioRevenue).toBe("0.0000");
    expect(result.scenarioCost).toBe("0.0000");
    expect(result.scenarioContribution).toBe("0.0000");
    expect(result.lines[0]?.scenarioUnits).toBe("0");
    expect(result.unmodelled.some((line) => line.includes("menu removal"))).toBe(false);
  });

  it("adds a menu option's contribution at the expected units", async () => {
    const result = await simulateScenario(
      seed(),
      scenario({ menuAdds: [{ recipeId: "recipe-sauce", expectedUnitsPerPeriod: "50" }] }),
    );

    const added = result.lines.find((line) => line.kind === "added");
    expect(added).toBeDefined();
    expect(added).toMatchObject({
      label: "Sauce",
      baselineUnits: "0",
      scenarioUnits: "50",
      unitCost: "0.1010",
      scenarioRevenue: "400.0000",
      scenarioCost: "5.0500",
      scenarioContribution: "394.9500",
    });
    expect(result.scenarioContribution).toBe("1264.4500");
  });

  it("reports a menu addition that cannot be modelled rather than guessing", async () => {
    const store = seed();
    store.assignments.length = 0;

    const result = await simulateScenario(
      store,
      scenario({ menuAdds: [{ recipeId: "recipe-sauce", expectedUnitsPerPeriod: "50" }] }),
    );

    expect(result.lines.some((line) => line.kind === "added")).toBe(false);
    expect(result.unmodelled.some((line) => line.includes("no product variant is assigned"))).toBe(
      true,
    );
  });

  it("adds headcount cost at the effective rate and the hours it buys", async () => {
    const result = await simulateScenario(
      seed(),
      scenario({
        headcountChange: [
          { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160", costCenterId: "cc-1" },
        ],
      }),
    );

    // 2 × 160 h = 320 h × 120.00 = 38400.0000, added to the scenario cost.
    expect(result.scenarioCost).toBe("38530.5000");
    expect(result.capacity.addedSuppliedHours).toBe("320.000000");
    expect(result.capacity.baselineRequiredHours).toBe("1.000000");
    expect(result.capacity.scenarioSuppliedHours).toBe("321.000000");
    expect(result.capacity.gapHours).toBe("-320.000000");
  });

  it("reports a headcount change with no effective rate as unmodelled", async () => {
    const store = seed();
    store.costing.laborRates.length = 0;

    const result = await simulateScenario(
      store,
      scenario({
        headcountChange: [
          { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160", costCenterId: "cc-1" },
        ],
      }),
    );

    expect(result.capacity.addedSuppliedHours).toBe("320.000000");
    // With no rate the recipe's direct labour is also a modelled zero, so the
    // baseline cost drops to ingredient + packaging only.
    expect(result.scenarioCost).toBe("10.5000");
    expect(result.unmodelled.some((line) => line.includes("no effective labour rate"))).toBe(true);
    expect(
      result.unmodelled.some((line) => line.includes("direct labour is modelled as zero")),
    ).toBe(true);
  });

  it("reports a headcount change with no cost centre as unmodelled", async () => {
    const result = await simulateScenario(
      seed(),
      scenario({
        headcountChange: [{ roleCode: "kitchen", countDelta: "1", hoursPerPeriod: "40" }],
      }),
    );

    expect(result.unmodelled.some((line) => line.includes("no costCenterId"))).toBe(true);
  });

  it("scales only the direct-labour component on a wage change", async () => {
    const result = await simulateScenario(seed(), scenario({ wageChangePct: "10" }));

    // labour 1.2000 -> 1.3200; unit cost 0.1000 + 0.0050 + 1.3200 = 1.4250.
    expect(result.baselineCost).toBe("130.5000");
    expect(result.scenarioCost).toBe("142.5000");
    expect(result.assumptions.some((line) => line.includes("direct-labour component"))).toBe(true);
  });

  it("holds channel fees and allocated overhead at zero and says so", async () => {
    const result = await simulateScenario(seed(), scenario());

    expect(result.assumptions.some((line) => line.includes("held at zero"))).toBe(true);
    expect(
      result.unmodelled.some((line) => line.includes("channel fees and allocated overhead")),
    ).toBe(true);
  });

  it("reports a product that cannot be costed instead of guessing", async () => {
    const store = seed();
    store.priceVersions.length = 0;

    const result = await simulateScenario(store, scenario());

    expect(result.lines).toHaveLength(0);
    expect(result.baselineRevenue).toBe("0.0000");
    expect(result.unmodelled.some((line) => line.includes("no effective price version"))).toBe(
      true,
    );
  });

  it("reports an unmapped sales group as unmodelled", async () => {
    const store = seed();
    store.summary = {
      rows: [
        groupRow({ key: "unmapped", label: "Unmapped", productVariantId: null, units: "5.000000" }),
      ],
      transactions: 1,
    };

    const result = await simulateScenario(store, scenario());

    expect(result.lines).toHaveLength(0);
    expect(result.unmodelled.some((line) => line.includes("no resolved product variant"))).toBe(
      true,
    );
  });

  it("rejects a malformed percentage before reading", async () => {
    await expect(simulateScenario(seed(), scenario({ volumeChangePct: "abc" }))).rejects.toThrow(
      /valid decimal/,
    );
    await expect(
      simulateScenario(seed(), scenario({ priceChangePct: "1.2345678" })),
    ).rejects.toThrow(/more than 6 decimal places/);
  });

  it("rejects a baseline window with to before from", async () => {
    await expect(
      simulateScenario(seed(), scenario({ baseline: { periodFrom: TO, periodTo: FROM } })),
    ).rejects.toThrow(/periodTo must be on or after/);
  });
});
