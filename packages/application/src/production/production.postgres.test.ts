import { randomUUID } from "node:crypto";
import {
  createDb,
  item,
  listDataQualityExceptions,
  location,
  recipe,
  recipeLine,
  recipeVersion,
  storageArea,
  unit,
  unitConversion,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postStockMovement } from "../inventory";

import { completeProductionBatch } from "./complete-production-batch";
import { createProductionBatch } from "./create-production-batch";
import { createProductionPlan } from "./create-production-plan";
import { createPostgresProductionStore } from "./postgres-store";
import { releaseProductionBatch } from "./release-production-batch";
import { startProductionBatch } from "./start-production-batch";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
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

interface Fixture {
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly inputItemId: string;
  readonly outputItemId: string;
  readonly recipeVersionId: string;
}

async function seedFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const kg = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `kg_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const grams = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: false })
    .returning();
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Production IT" })
    .returning();
  const area = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: createdLocation[0]!.id,
      code: `area_${suffix}`,
      name: "Dry store",
      kind: "dry_store",
    })
    .returning();
  const input = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `flour_${suffix}`,
      sku: `FLOUR_${suffix}`,
      name: "Flour",
      itemType: "ingredient",
      baseUnitId: kg[0]!.id,
    })
    .returning();
  const output = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `cake_${suffix}`,
      sku: `CAKE_${suffix}`,
      name: "Cake",
      itemType: "intermediate",
      baseUnitId: kg[0]!.id,
    })
    .returning();
  await tx.insert(unitConversion).values({
    organizationId: orgId,
    fromUnitId: grams[0]!.id,
    toUnitId: kg[0]!.id,
    factor: "0.001",
    effectiveFrom: EFFECTIVE_FROM,
  });
  const recipeRow = await tx
    .insert(recipe)
    .values({
      organizationId: orgId,
      code: `cake_${suffix}`,
      name: "Cake",
      outputItemId: output[0]!.id,
    })
    .returning();
  const version = await tx
    .insert(recipeVersion)
    .values({
      recipeId: recipeRow[0]!.id,
      versionNo: 1,
      state: "approved",
      plannedInputQty: "1.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "1.000000",
      yieldRate: "1.000000",
      effectiveFrom: EFFECTIVE_FROM,
      approvedBy: randomUUID(),
      approvedAt: new Date(),
    })
    .returning();
  await tx.insert(recipeLine).values({
    recipeVersionId: version[0]!.id,
    componentKind: "ingredient",
    itemId: input[0]!.id,
    quantity: "500.000000",
    unitId: grams[0]!.id,
    lossFactor: "1",
  });

  return {
    locationId: createdLocation[0]!.id,
    storageAreaId: area[0]!.id,
    inputItemId: input[0]!.id,
    outputItemId: output[0]!.id,
    recipeVersionId: version[0]!.id,
  };
}

/** Seeds opening stock at the item's moving weighted average of 4.0000. */
async function seedStock(
  store: ReturnType<typeof createPostgresProductionStore>,
  orgId: string,
  fixture: Fixture,
  actorId: string,
): Promise<void> {
  await postStockMovement(store, {
    organizationId: orgId,
    actorId,
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.inputItemId,
    movementType: "correction",
    sourceType: "correction",
    sourceId: randomUUID(),
    quantityDelta: "100.000000",
    unitCost: "4.0000",
    occurredAt: "2026-01-01T10:00:00.000Z",
    reasonCode: "seeded opening",
  });
}

describe.skipIf(!databaseUrl)("production vertical against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Production IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("plans, runs and atomically completes a batch, converting units and posting both sides", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresProductionStore(tx);
      const actorId = randomUUID();
      await seedStock(store, orgId, fixture, actorId);

      const plan = await createProductionPlan(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        productionDate: "2026-02-01",
      });
      const created = await createProductionBatch(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        recipeVersionId: fixture.recipeVersionId,
        planId: plan.productionPlanId,
        destinationStorageAreaId: fixture.storageAreaId,
        plannedStart: "2026-02-01T08:00:00.000Z",
      });
      // 500 g converted to the item's kg base unit.
      expect(created.plannedInputs).toEqual([
        { itemId: fixture.inputItemId, unitId: expect.any(String), plannedQty: "0.500000" },
      ]);
      expect(created.plannedOutputQty).toBe("1.000000");

      await releaseProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
      });
      await startProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualStart: "2026-02-01T08:30:00.000Z",
      });

      const completed = await completeProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualFinish: "2026-02-01T10:00:00.000Z",
        inputStorageAreaId: fixture.storageAreaId,
        inputs: [{ itemId: fixture.inputItemId, actualQty: "0.600000", reasonCode: "trim loss" }],
        output: { itemId: fixture.outputItemId, actualQty: "1.000000" },
        idempotencyKey: `prod-it-${suffix}`,
      });
      // 0.6 kg at the locked average 4.0000 = 2.4000, over 1.0 kg output.
      expect(completed).toMatchObject({
        status: "completed",
        inputValue: "2.4000",
        outputUnitCost: "2.4000",
        yieldVariancePct: "0.000000",
        replayed: false,
      });

      const movements = await store.listStockMovements({ organizationId: orgId });
      const batchMovements = movements.filter(
        (movement) =>
          movement.sourceType === "production_batch" &&
          movement.sourceId === created.productionBatchId,
      );
      expect(batchMovements).toHaveLength(2);
      const consumption = batchMovements.find(
        (movement) => movement.movementType === "production_consumption",
      );
      expect(consumption).toMatchObject({
        quantityDelta: "-0.600000",
        unitCost: "4.0000",
        valueDelta: "-2.4000",
      });
      const output = batchMovements.find(
        (movement) => movement.movementType === "production_output",
      );
      expect(output).toMatchObject({
        quantityDelta: "1.000000",
        unitCost: "2.4000",
        valueDelta: "2.4000",
      });
      // WASTE-002: expected yield loss is never posted as a waste movement.
      expect(
        movements.some(
          (movement) =>
            movement.movementType === "waste" && movement.sourceId === created.productionBatchId,
        ),
      ).toBe(false);

      const inputs = await store.listProductionBatchInputs({
        organizationId: orgId,
        productionBatchId: created.productionBatchId,
      });
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        plannedQty: "0.500000",
        actualQty: "0.600000",
        varianceQty: "0.100000",
        reasonCode: "trim loss",
      });

      const replay = await completeProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualFinish: "2026-02-01T10:00:00.000Z",
        inputStorageAreaId: fixture.storageAreaId,
        inputs: [{ itemId: fixture.inputItemId, actualQty: "0.600000", reasonCode: "trim loss" }],
        output: { itemId: fixture.outputItemId, actualQty: "1.000000" },
        idempotencyKey: `prod-it-${suffix}`,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.movementIds).toEqual(completed.movementIds);

      // The exact completion has zero yield variance, so no DEC-080 exception.
      const exceptionRows = (
        await listDataQualityExceptions(tx, {
          organizationId: orgId,
          entityType: "production_batch",
        })
      ).filter((row) => row.entityId === created.productionBatchId);
      expect(exceptionRows).toHaveLength(0);
    });
  });

  it("records one yield_variance exception on a non-zero completion variance", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresProductionStore(tx);
      const actorId = randomUUID();
      await seedStock(store, orgId, fixture, actorId);

      const created = await createProductionBatch(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        recipeVersionId: fixture.recipeVersionId,
        destinationStorageAreaId: fixture.storageAreaId,
      });
      await releaseProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
      });
      await startProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualStart: "2026-02-01T08:30:00.000Z",
      });

      const completed = await completeProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualFinish: "2026-02-01T10:00:00.000Z",
        inputStorageAreaId: fixture.storageAreaId,
        inputs: [{ itemId: fixture.inputItemId, actualQty: "0.600000", reasonCode: "trim loss" }],
        output: { itemId: fixture.outputItemId, actualQty: "0.800000" },
      });
      expect(completed.yieldVariancePct).toBe("-0.200000");

      // Exactly one yield_variance exception, read back through the persistence
      // repository, written in the same transaction as the completion (DEC-080).
      const exceptions = (
        await listDataQualityExceptions(tx, {
          organizationId: orgId,
          entityType: "production_batch",
        })
      ).filter((row) => row.entityId === created.productionBatchId);
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0]).toMatchObject({
        organizationId: orgId,
        ruleCode: "yield_variance",
        severity: "medium",
        entityType: "production_batch",
        entityId: created.productionBatchId,
        status: "open",
        resolution: null,
      });
      expect(exceptions[0]?.detectedAt).toBeInstanceOf(Date);
    });
  });
});
