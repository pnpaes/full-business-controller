import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import type { StockBalanceKey } from "../inventory";
import {
  cancelProductionBatch,
  completeProductionBatch,
  createProductionBatch,
  createProductionPlan,
  getProductionBatch,
  listProductionBatches,
  listProductionPlans,
  releaseProductionBatch,
  startProductionBatch,
} from "./index";
import type { ProductionBatchInputRecord } from "./types";
import { FakeProductionStore, seedProductionFixture, type ProductionFixture } from "./test-support";

const ACTOR = "actor";
const AT = "2026-02-01T10:00:00.000Z";

interface Context {
  readonly store: FakeProductionStore;
  readonly fixture: ProductionFixture;
}

async function seedBalance(
  store: FakeProductionStore,
  fixture: ProductionFixture,
  quantityOnHand: string,
  valueOnHand: string,
  avgUnitCost: string,
): Promise<void> {
  const key: StockBalanceKey = {
    organizationId: fixture.organizationId,
    itemId: fixture.itemId,
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    lotId: null,
  };
  const at = new Date("2026-01-01T00:00:00.000Z");
  await store.lockStockBalance(key, at);
  await store.saveStockBalance(key, {
    quantityOnHand,
    valueOnHand,
    avgUnitCost,
    asOf: at,
  });
}

async function setup(balanceQuantity = "10.000000"): Promise<Context> {
  const store = new FakeProductionStore();
  const fixture = seedProductionFixture(store);
  await seedBalance(store, fixture, balanceQuantity, "20.0000", "2.0000");
  return { store, fixture };
}

async function plannedBatch(context: Context): Promise<string> {
  const { store, fixture } = context;
  const created = await createProductionBatch(store, {
    organizationId: fixture.organizationId,
    actorId: ACTOR,
    locationId: fixture.locationId,
    recipeVersionId: fixture.recipeVersionId,
    destinationStorageAreaId: fixture.storageAreaId,
  });
  return created.productionBatchId;
}

async function runningBatch(context: Context): Promise<string> {
  const batchId = await plannedBatch(context);
  await releaseProductionBatch(context.store, {
    organizationId: context.fixture.organizationId,
    actorId: ACTOR,
    productionBatchId: batchId,
  });
  await startProductionBatch(context.store, {
    organizationId: context.fixture.organizationId,
    actorId: ACTOR,
    productionBatchId: batchId,
  });
  return batchId;
}

function completeInput(context: Context, batchId: string) {
  const { fixture } = context;
  return {
    organizationId: fixture.organizationId,
    actorId: ACTOR,
    productionBatchId: batchId,
    actualFinish: AT,
    inputStorageAreaId: fixture.storageAreaId,
    inputs: [{ itemId: fixture.itemId, actualQty: "0.600000", reasonCode: "trim loss" }],
    output: { itemId: fixture.outputItemId, actualQty: "1.000000" },
  } as const;
}

describe("createProductionPlan", () => {
  it("creates a plan header in the organization with the given date/status", async () => {
    const { store, fixture } = await setup();
    const result = await createProductionPlan(store, {
      organizationId: fixture.organizationId,
      actorId: ACTOR,
      locationId: fixture.locationId,
      productionDate: "2026-03-01",
    });
    expect(result.status).toBe("planned");
    expect(result.replayed).toBe(false);
    const plan = store.productionPlans.get(result.productionPlanId);
    expect(plan?.organizationId).toBe(fixture.organizationId);
    expect(plan?.productionDate).toBe("2026-03-01");
  });

  it("rejects an unknown location and replays a deterministic id", async () => {
    const { store, fixture } = await setup();
    await expect(
      createProductionPlan(store, {
        organizationId: fixture.organizationId,
        actorId: ACTOR,
        locationId: "loc-nope",
        productionDate: "2026-03-01",
      }),
    ).rejects.toThrow(/location not found/);

    const first = await createProductionPlan(store, {
      organizationId: fixture.organizationId,
      actorId: ACTOR,
      locationId: fixture.locationId,
      productionDate: "2026-03-01",
      productionPlanId: "plan-fixed",
    });
    const replay = await createProductionPlan(store, {
      organizationId: fixture.organizationId,
      actorId: ACTOR,
      locationId: fixture.locationId,
      productionDate: "2026-03-01",
      productionPlanId: "plan-fixed",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.productionPlanId).toBe(first.productionPlanId);
    expect(store.productionPlans.size).toBe(1);
  });
});

describe("createProductionBatch", () => {
  it("snapshots the planned lines from an approved version, converting to base units", async () => {
    const context = await setup();
    const created = await createProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      recipeVersionId: context.fixture.recipeVersionId,
    });
    expect(created.status).toBe("planned");
    expect(created.plannedOutputQty).toBe("1.000000");
    // 500 g at factor 0.001 → 0.5 kg, in the item base unit.
    expect(created.plannedInputs).toEqual([
      { itemId: context.fixture.itemId, unitId: context.fixture.unitId, plannedQty: "0.500000" },
    ]);
    expect(created.plannedOutputs).toEqual([
      {
        itemId: context.fixture.outputItemId,
        unitId: context.fixture.unitId,
        kind: "finished",
        plannedQty: "1.000000",
      },
    ]);
    const batch = context.store.productionBatches.get(created.productionBatchId);
    expect(batch?.plannedOutputQty).toBe("1.000000");
    expect(batch?.status).toBe("planned");
  });

  it("enforces an approved recipe version (PROD-001)", async () => {
    const context = await setup();
    await expect(
      createProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        locationId: context.fixture.locationId,
        recipeVersionId: context.fixture.draftRecipeVersionId,
      }),
    ).rejects.toThrow(/must be approved.*PROD-001/);
    await expect(
      createProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        locationId: context.fixture.locationId,
        recipeVersionId: "missing",
      }),
    ).rejects.toThrow(/recipe version not found/);
  });

  it("rejects a foreign-organization recipe and a mismatched destination area", async () => {
    const context = await setup();
    context.store.recipes.set(context.fixture.recipeId, {
      ...context.store.recipes.get(context.fixture.recipeId)!,
      organizationId: "org-other",
    });
    await expect(
      createProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        locationId: context.fixture.locationId,
        recipeVersionId: context.fixture.recipeVersionId,
      }),
    ).rejects.toThrow(/recipe not found in organization/);

    const fresh = await setup();
    await expect(
      createProductionBatch(fresh.store, {
        organizationId: fresh.fixture.organizationId,
        actorId: ACTOR,
        locationId: fresh.fixture.otherLocationId,
        recipeVersionId: fresh.fixture.recipeVersionId,
        destinationStorageAreaId: fresh.fixture.storageAreaId,
      }),
    ).rejects.toThrow(/storage area does not belong to the location/);
  });

  it("replays a deterministic batch id instead of creating a second batch", async () => {
    const context = await setup();
    const first = await createProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      recipeVersionId: context.fixture.recipeVersionId,
      productionBatchId: "batch-fixed",
    });
    const replay = await createProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      recipeVersionId: context.fixture.recipeVersionId,
      productionBatchId: "batch-fixed",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.productionBatchId).toBe(first.productionBatchId);
    expect(context.store.productionBatches.size).toBe(1);
  });
});

describe("batch state machine", () => {
  let context: Context;
  beforeEach(async () => {
    context = await setup();
  });

  it("moves planned → released → in_progress with an actual start", async () => {
    const batchId = await plannedBatch(context);
    const released = await releaseProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
    });
    expect(released.status).toBe("released");
    const started = await startProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
      actualStart: "2026-02-01T09:00:00.000Z",
    });
    expect(started.status).toBe("in_progress");
    expect(started.actualStart).toBe("2026-02-01T09:00:00.000Z");
  });

  it("rejects illegal transitions", async () => {
    const batchId = await plannedBatch(context);
    await expect(
      startProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: batchId,
      }),
    ).rejects.toThrow(/can only be started from released/);

    await releaseProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
    });
    await expect(
      releaseProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: batchId,
      }),
    ).rejects.toThrow(/can only be released from planned/);

    await expect(
      completeProductionBatch(context.store, completeInput(context, batchId)),
    ).rejects.toThrow(/can only be completed from in_progress/);
  });

  it("cancels a non-completed batch and refuses a completed one", async () => {
    const batchId = await plannedBatch(context);
    const cancelled = await cancelProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
    });
    expect(cancelled.status).toBe("cancelled");
    await expect(
      cancelProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: batchId,
      }),
    ).rejects.toThrow(/already cancelled/);

    const completedId = await runningBatch(context);
    await completeProductionBatch(context.store, completeInput(context, completedId));
    await expect(
      cancelProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: completedId,
      }),
    ).rejects.toThrow(/completed batch cannot be cancelled/);
  });
});

describe("completeProductionBatch", () => {
  it("posts one atomic batch, values consumption at the average and output at B3", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const result = await completeProductionBatch(context.store, completeInput(context, batchId));

    expect(result.status).toBe("completed");
    expect(result.inputValue).toBe("1.2000");
    expect(result.outputUnitCost).toBe("1.2000");
    expect(result.actualOutputQty).toBe("1.000000");
    expect(result.yieldVariancePct).toBe("0.000000");
    expect(result.movementIds).toHaveLength(2);

    const movements = [...context.store.stockMovements.values()].filter(
      (movement) => movement.sourceType === "production_batch" && movement.sourceId === batchId,
    );
    expect(movements).toHaveLength(2);

    const consumption = movements.find(
      (movement) => movement.movementType === "production_consumption",
    );
    expect(consumption?.quantityDelta).toBe("-0.600000");
    expect(consumption?.unitCost).toBe("2.0000");
    expect(consumption?.valueDelta).toBe("-1.2000");

    const output = movements.find((movement) => movement.movementType === "production_output");
    expect(output?.quantityDelta).toBe("1.000000");
    expect(output?.unitCost).toBe("1.2000");
    expect(output?.valueDelta).toBe("1.2000");

    // WASTE-002: expected loss lives in the yield rule; nothing posts `waste`.
    expect(
      [...context.store.stockMovements.values()].some(
        (movement) => movement.movementType === "waste",
      ),
    ).toBe(false);

    const detail = await getProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      productionBatchId: batchId,
    });
    expect(detail?.batch.status).toBe("completed");
    expect(detail?.batch.actualFinish).toBe(AT);
    expect(detail?.batch.yieldVariancePct).toBe("0.000000");
    expect(detail?.inputs).toHaveLength(1);
    expect(detail?.inputs[0]).toMatchObject({
      plannedQty: "0.500000",
      actualQty: "0.600000",
      varianceQty: "0.100000",
      reasonCode: "trim loss",
    });
    expect(detail?.inputs[0]?.movementId).toBe(consumption?.id);
    expect(detail?.outputs).toHaveLength(1);
    expect(detail?.outputs[0]).toMatchObject({
      kind: "finished",
      plannedQty: "1.000000",
      actualQty: "1.000000",
      varianceQty: "0.000000",
    });
    expect(detail?.outputs[0]?.movementId).toBe(output?.id);
  });

  it("records a shortfall with a negative yield variance and a positive output cost", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const result = await completeProductionBatch(context.store, {
      ...completeInput(context, batchId),
      inputs: [{ itemId: context.fixture.itemId, actualQty: "0.300000", reasonCode: "shortfall" }],
      output: { itemId: context.fixture.outputItemId, actualQty: "0.800000" },
    });
    // 0.3 kg at average 2.0000 → 0.6000; / 0.8 output = 0.7500.
    expect(result.outputUnitCost).toBe("0.7500");
    expect(result.inputValue).toBe("0.6000");
    expect(result.yieldVariancePct).toBe("-0.200000");
  });

  it("records one yield_variance exception on a non-zero yield variance", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const result = await completeProductionBatch(context.store, {
      ...completeInput(context, batchId),
      output: { itemId: context.fixture.outputItemId, actualQty: "0.800000" },
    });
    expect(result.yieldVariancePct).toBe("-0.200000");

    // The input variance (0.6 vs planned 0.5) is stored on the line but does
    // not itself produce an exception (PROD-004); only the output yield does.
    const exceptions = [...context.store.dataQualityExceptions.values()];
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      organizationId: context.fixture.organizationId,
      ruleCode: "yield_variance",
      severity: "medium",
      entityType: "production_batch",
      entityId: batchId,
      detectedAt: AT,
      status: "open",
      resolution: null,
    });
  });

  it("replays a non-zero yield variance without a second exception", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const input = {
      ...completeInput(context, batchId),
      output: { itemId: context.fixture.outputItemId, actualQty: "0.800000" },
      idempotencyKey: "complete-yield-replay",
    };
    const first = await completeProductionBatch(context.store, input);
    expect(first.replayed).toBe(false);
    expect(first.yieldVariancePct).toBe("-0.200000");
    expect(context.store.dataQualityExceptions.size).toBe(1);

    const replay = await completeProductionBatch(context.store, input);
    expect(replay.replayed).toBe(true);
    expect(replay.movementIds).toEqual(first.movementIds);
    expect(context.store.dataQualityExceptions.size).toBe(1);
  });

  it("records no exception when the actual output exactly matches the plan", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const result = await completeProductionBatch(context.store, completeInput(context, batchId));
    expect(result.yieldVariancePct).toBe("0.000000");
    expect(context.store.dataQualityExceptions.size).toBe(0);
  });

  it("skips the ledger movement for a zero actual while still recording the line", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const result = await completeProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
      actualFinish: AT,
      inputStorageAreaId: context.fixture.storageAreaId,
      inputs: [{ itemId: context.fixture.itemId, actualQty: "0.000000", reasonCode: "not used" }],
      output: { itemId: context.fixture.outputItemId, actualQty: "1.000000" },
    });
    expect(result.movementIds).toHaveLength(1);
    expect(result.inputValue).toBe("0.0000");
    expect(result.outputUnitCost).toBe("0.0000");
    const detail = await getProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      productionBatchId: batchId,
    });
    expect(detail?.inputs[0]).toMatchObject({ actualQty: "0.000000", movementId: null });
  });

  it("replays an idempotent retry without double-posting", async () => {
    const context = await setup();
    const batchId = await runningBatch(context);
    const first = await completeProductionBatch(context.store, {
      ...completeInput(context, batchId),
      idempotencyKey: "complete-1",
    });
    expect(first.replayed).toBe(false);
    const movementsAfterFirst = context.store.stockMovements.size;

    const replay = await completeProductionBatch(context.store, {
      ...completeInput(context, batchId),
      idempotencyKey: "complete-1",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.movementIds).toEqual(first.movementIds);
    expect(context.store.stockMovements.size).toBe(movementsAfterFirst);
    expect(context.store.productionBatchInputs).toHaveLength(1);
  });

  it("rolls back the whole completion when the DEC-010 guard fires", async () => {
    const context = await setup("0.100000");
    const batchId = await runningBatch(context);
    await expect(
      completeProductionBatch(context.store, completeInput(context, batchId)),
    ).rejects.toThrow(/would drive stock negative/);

    expect(context.store.stockMovements.size).toBe(0);
    expect(context.store.productionBatchInputs).toHaveLength(0);
    expect(context.store.productionBatchOutputs).toHaveLength(0);
    const batch = context.store.productionBatches.get(batchId);
    expect(batch?.status).toBe("in_progress");
    expect(batch?.actualOutputQty).toBeNull();
  });

  it("rejects missing/extra actuals, a reason-less variance and a non-positive output", async () => {
    const context = await setup();
    const base = completeInput(context, await runningBatch(context));

    await expect(completeProductionBatch(context.store, { ...base, inputs: [] })).rejects.toThrow(
      /missing actual quantity/,
    );
    await expect(
      completeProductionBatch(context.store, {
        ...base,
        inputs: [
          { itemId: context.fixture.itemId, actualQty: "0.500000" },
          { itemId: context.fixture.outputItemId, actualQty: "1.000000" },
        ],
      }),
    ).rejects.toThrow(/unexpected input item/);
    await expect(
      completeProductionBatch(context.store, {
        ...base,
        inputs: [{ itemId: context.fixture.itemId, actualQty: "0.600000" }],
      }),
    ).rejects.toThrow(/reason is required.*PROD-004/);
    await expect(
      completeProductionBatch(context.store, {
        ...base,
        output: { itemId: context.fixture.outputItemId, actualQty: "0.000000" },
      }),
    ).rejects.toThrow(/actual output quantity must be positive/);
    await expect(
      completeProductionBatch(context.store, {
        ...base,
        output: { itemId: context.fixture.itemId, actualQty: "1.000000" },
      }),
    ).rejects.toThrow(/only the recipe version's output item/);
  });

  it("fails clearly when a storage area is absent (open point (e))", async () => {
    const context = await setup();
    // A header with no destination area at all.
    const noDestination = await createProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      recipeVersionId: context.fixture.recipeVersionId,
    });
    const batchId = noDestination.productionBatchId;
    await releaseProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
    });
    await startProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: batchId,
    });
    await expect(
      completeProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: batchId,
        actualFinish: AT,
        inputStorageAreaId: context.fixture.storageAreaId,
        inputs: [{ itemId: context.fixture.itemId, actualQty: "0.500000" }],
        output: { itemId: context.fixture.outputItemId, actualQty: "1.000000" },
      }),
    ).rejects.toThrow(/no destination storage area/);

    // A batch with a destination but no draw area still fails clearly.
    const withDestination = await createProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      recipeVersionId: context.fixture.recipeVersionId,
      destinationStorageAreaId: context.fixture.storageAreaId,
    });
    await releaseProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: withDestination.productionBatchId,
    });
    await startProductionBatch(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      productionBatchId: withDestination.productionBatchId,
    });
    await expect(
      completeProductionBatch(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: ACTOR,
        productionBatchId: withDestination.productionBatchId,
        actualFinish: AT,
        inputs: [{ itemId: context.fixture.itemId, actualQty: "0.500000" }],
        output: { itemId: context.fixture.outputItemId, actualQty: "1.000000" },
      }),
    ).rejects.toThrow(/inputStorageAreaId is required/);
  });
});

describe("reads", () => {
  it("lists plans/batches organization-scoped with paging", async () => {
    const context = await setup();
    await createProductionPlan(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      productionDate: "2026-03-01",
    });
    await createProductionPlan(context.store, {
      organizationId: context.fixture.organizationId,
      actorId: ACTOR,
      locationId: context.fixture.locationId,
      productionDate: "2026-04-01",
    });
    context.store.productionPlans.set("foreign", {
      id: "foreign",
      organizationId: "org-other",
      locationId: "loc-other",
      productionDate: "2026-05-01",
      status: "planned",
      createdAt: AT,
      createdBy: null,
    });

    const page = await listProductionPlans(context.store, {
      organizationId: context.fixture.organizationId,
      limit: 1,
    });
    expect(page.plans).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.plans[0]?.productionDate).toBe("2026-04-01");

    const batchId = await plannedBatch(context);
    const batches = await listProductionBatches(context.store, {
      organizationId: context.fixture.organizationId,
      status: "planned",
    });
    expect(batches.batches.map((batch) => batch.id)).toContain(batchId);
    expect(
      batches.batches.every((batch) => batch.organizationId === context.fixture.organizationId),
    ).toBe(true);
  });

  it("rejects an out-of-range limit before touching the store", async () => {
    const context = await setup();
    await expect(
      listProductionBatches(context.store, {
        organizationId: context.fixture.organizationId,
        limit: 0,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("input line typing", () => {
  it("exposes the completion line shape used by the detail read", () => {
    const line: ProductionBatchInputRecord = {
      id: "x",
      productionBatchId: "b",
      itemId: "i",
      unitId: "u",
      plannedQty: "1.000000",
      actualQty: null,
      varianceQty: null,
      lotId: null,
      reasonCode: null,
      movementId: null,
    };
    expect(line.plannedQty).toBe("1.000000");
  });
});
