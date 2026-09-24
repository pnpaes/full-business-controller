import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { computeProductionBatchCost } from "./compute-batch-cost";
import { FakeProductionBatchCostStore } from "./test-support";

const ORG = "org-1";
const LOCATION = "loc-1";
const RECIPE_ID = "recipe-cake";
const VERSION_ID = "rv-approved";
const BATCH_ID = "batch-1";
const COST_CENTER = "cc-1";
const ROLE = "chef";
const FINISH = "2026-06-01T10:00:00.000Z";

/** The theoretical fixture: 500 g flour at 20.0000/kg → 10.0000 per usable unit. */
function seedRecipe(store: FakeProductionBatchCostStore, laborMapped = true): void {
  store.units.set("unit-kg", { id: "unit-kg", code: "kg", dimension: "mass", isBase: true });
  store.units.set("unit-g", { id: "unit-g", code: "g", dimension: "mass", isBase: false });
  store.conversions.push({
    fromUnit: { id: "unit-g", code: "g", dimension: "mass", isBase: false },
    toUnit: { id: "unit-kg", code: "kg", dimension: "mass", isBase: true },
    factor: "0.001",
    itemId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
  });
  store.items.set("item-flour", {
    id: "item-flour",
    organizationId: ORG,
    code: "FLOUR",
    name: "Flour",
    baseUnitId: "unit-kg",
    currentCost: "20.0000",
  });
  store.recipes.set(RECIPE_ID, {
    id: RECIPE_ID,
    organizationId: ORG,
    code: "CAKE",
    name: "Cake",
    outputItemId: "item-cake",
  });
  store.versions.push({
    id: VERSION_ID,
    recipeId: RECIPE_ID,
    versionNo: 1,
    state: "approved",
    plannedInputQty: "1.000000",
    plannedOutputQty: "2.000000",
    approvedUsableOutput: "1.000000",
    yieldRate: "1.000000",
    preparationMinutes: null,
    laborCostCenterId: laborMapped ? COST_CENTER : null,
    laborRoleCode: laborMapped ? ROLE : null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    approvedBy: "approver-1",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
    notes: null,
    method: null,
  });
  store.lines.push({
    id: "rl-1",
    recipeVersionId: VERSION_ID,
    componentKind: "ingredient",
    itemId: "item-flour",
    subRecipeId: null,
    quantity: "500.000000",
    unitId: "unit-g",
    lossFactor: "1",
    stage: null,
    substitutionGroup: null,
  });
}

function seedLabour(store: FakeProductionBatchCostStore): void {
  store.costing.laborRates.push({
    id: "lr-1",
    organizationId: ORG,
    costCenterId: COST_CENTER,
    roleCode: ROLE,
    loadedHourlyRate: "250.00",
    productiveHoursPct: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
}

interface BatchOverrides {
  readonly status?: string;
  readonly actualOutputQty?: string | null;
  readonly actualLabourHours?: string | null;
  readonly yieldVariancePct?: string | null;
  readonly organizationId?: string;
}

function seedBatch(store: FakeProductionBatchCostStore, overrides: BatchOverrides = {}): void {
  store.production.productionBatches.set(BATCH_ID, {
    id: BATCH_ID,
    organizationId: overrides.organizationId ?? ORG,
    locationId: LOCATION,
    workstation: null,
    recipeVersionId: VERSION_ID,
    planId: null,
    status: overrides.status ?? "completed",
    plannedStart: null,
    actualStart: null,
    actualFinish: FINISH,
    operatorId: null,
    destinationStorageAreaId: null,
    plannedOutputQty: "2.000000",
    actualOutputQty: overrides.actualOutputQty ?? "2.000000",
    yieldVariancePct: overrides.yieldVariancePct ?? "0.000000",
    actualLabourHours:
      overrides.actualLabourHours === undefined ? "1.50" : overrides.actualLabourHours,
    reversalOfId: null,
    createdAt: "2026-06-01T09:00:00.000Z",
  });
}

/** Two consumption movements whose `value_delta` sum to 4.2500. */
function seedConsumption(store: FakeProductionBatchCostStore): void {
  const movement = (id: string, valueDelta: string) => ({
    id,
    organizationId: ORG,
    locationId: LOCATION,
    storageAreaId: "area-1",
    itemId: "item-flour",
    lotId: null,
    movementType: "production_consumption",
    quantityDelta: "-0.250000",
    unitId: "unit-kg",
    unitCost: null,
    valueDelta,
    currency: "NOK",
    sourceType: "production_batch",
    sourceId: BATCH_ID,
    reversalOfId: null,
    occurredAt: FINISH,
    postedAt: FINISH,
    postedBy: "user-1",
    reasonCode: null,
    idempotencyKey: null,
  });
  store.production.stockMovements.set("mv-1", movement("mv-1", "-3.0000"));
  store.production.stockMovements.set("mv-2", movement("mv-2", "-1.2500"));
  // An output movement that must NOT count toward the ingredient cost.
  store.production.stockMovements.set("mv-3", {
    ...movement("mv-3", "4.2500"),
    movementType: "production_output",
  });
}

function query(overrides: Partial<Parameters<typeof computeProductionBatchCost>[1]> = {}) {
  return { organizationId: ORG, productionBatchId: BATCH_ID, ...overrides };
}

let store: FakeProductionBatchCostStore;

beforeEach(() => {
  store = new FakeProductionBatchCostStore();
  seedRecipe(store);
  seedLabour(store);
  seedBatch(store);
  seedConsumption(store);
});

describe("computeProductionBatchCost", () => {
  it("computes the ingredient, labour and total cost from the ledger and the loaded rate", async () => {
    const cost = await computeProductionBatchCost(store, query());

    expect(cost.ingredientCost).toBe("4.2500");
    expect(cost.effectiveLoadedHourlyRate).toBe("250.00");
    expect(cost.labourCost).toBe("375.0000");
    expect(cost.allocatedOverhead).toBe("0.0000");
    expect(cost.totalBatchCost).toBe("379.2500");
    expect(cost.unitCost).toBe("189.6250");
    expect(cost.actualOutputQty).toBe("2.000000");
    expect(cost.actualHours).toBe("1.50");
    expect(cost.plannedOutputQty).toBe("2.000000");
    expect(cost.yieldVariancePct).toBe("0.000000");
    expect(cost.theoreticalUnitCost).toBe("10.0000");
    expect(cost.varianceUnitCost).toBe("-179.6250");
    expect(cost.currency).toBe("NOK");
    expect(cost.provenance.some((note) => note.includes("no cost pool supplied"))).toBe(true);
  });

  it("applies productive_hours_pct to the loaded rate (DEC-055)", async () => {
    store.costing.laborRates[0] = {
      ...store.costing.laborRates[0]!,
      productiveHoursPct: "0.800000",
    };
    const cost = await computeProductionBatchCost(store, query());

    // 250.00 / 0.8 = 312.50 (2 dp HALF_UP), then 1.50 h × 312.50 = 468.7500.
    expect(cost.effectiveLoadedHourlyRate).toBe("312.50");
    expect(cost.labourCost).toBe("468.7500");
  });

  it("rounds the B3 unit cost once, HALF_UP", async () => {
    store.production.stockMovements.set("mv-1", {
      ...store.production.stockMovements.get("mv-1")!,
      valueDelta: "-1.0000",
    });
    store.production.stockMovements.delete("mv-2");
    store.production.stockMovements.delete("mv-3");
    seedBatch(store, { actualLabourHours: "0", actualOutputQty: "3.000000" });

    const cost = await computeProductionBatchCost(store, query());

    expect(cost.totalBatchCost).toBe("1.0000");
    expect(cost.unitCost).toBe("0.3333");
  });

  it("treats a zero recorded labour input as zero labour", async () => {
    seedBatch(store, { actualLabourHours: "0" });
    const cost = await computeProductionBatchCost(store, query());

    expect(cost.actualHours).toBe("0.00");
    expect(cost.effectiveLoadedHourlyRate).toBe("250.00");
    expect(cost.labourCost).toBe("0.0000");
    expect(cost.totalBatchCost).toBe("4.2500");
  });

  it("reports zero labour with a provenance note when the version has no labour mapping", async () => {
    store.versions[0] = {
      ...store.versions[0]!,
      laborCostCenterId: null,
      laborRoleCode: null,
    };
    const cost = await computeProductionBatchCost(store, query());

    expect(cost.effectiveLoadedHourlyRate).toBeNull();
    expect(cost.labourCost).toBe("0.0000");
    expect(cost.totalBatchCost).toBe("4.2500");
    expect(cost.provenance.some((note) => note.includes("no labour mapping"))).toBe(true);
  });

  it("reports zero overhead with a note when no cost pool is supplied", async () => {
    const cost = await computeProductionBatchCost(store, query());
    expect(cost.allocatedOverhead).toBe("0.0000");
    expect(cost.provenance.some((note) => note.includes("no cost pool supplied"))).toBe(true);
  });

  it("returns the header's yield variance as a signed fraction", async () => {
    seedBatch(store, { yieldVariancePct: "-0.050000" });
    const cost = await computeProductionBatchCost(store, query());
    expect(cost.yieldVariancePct).toBe("-0.050000");
  });

  it("rejects a batch that is not completed with a message-only DomainError", async () => {
    seedBatch(store, { status: "in_progress" });
    await expect(computeProductionBatchCost(store, query())).rejects.toThrow(DomainError);
    await expect(computeProductionBatchCost(store, query())).rejects.toThrow(
      /only available for a completed batch/,
    );
  });

  it("does not find a batch owned by another organization", async () => {
    seedBatch(store, { organizationId: "org-2" });
    await expect(computeProductionBatchCost(store, query())).rejects.toThrow(
      /production batch not found in organization/,
    );
  });
});
