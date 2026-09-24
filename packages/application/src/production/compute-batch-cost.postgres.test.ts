import { randomUUID } from "node:crypto";
import {
  costCenter,
  createDb,
  item,
  laborRate,
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
import { computeProductionBatchCost } from "./compute-batch-cost";
import { createPostgresProductionBatchCostStore } from "./cost-postgres-store";
import { createProductionBatch } from "./create-production-batch";
import { createPostgresProductionStore } from "./postgres-store";
import { releaseProductionBatch } from "./release-production-batch";
import { startProductionBatch } from "./start-production-batch";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");
const ROLE = "kitchen";

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

interface Fixture {
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly inputItemId: string;
  readonly outputItemId: string;
  readonly recipeVersionId: string;
}

/** Seeds a 500 g cake recipe mapped to a kitchen labour rate, and an input at 20.0000/kg. */
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
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Batch cost IT" })
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
      currentCost: "20.0000",
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
  const centre = await tx
    .insert(costCenter)
    .values({ organizationId: orgId, code: `kitchen_${suffix}`, name: "Kitchen", kind: "kitchen" })
    .returning();
  await tx.insert(laborRate).values({
    organizationId: orgId,
    costCenterId: centre[0]!.id,
    roleCode: ROLE,
    loadedHourlyRate: "250.0000",
    effectiveFrom: "2026-01-01",
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
      laborCostCenterId: centre[0]!.id,
      laborRoleCode: ROLE,
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

describe.skipIf(!databaseUrl)("computeProductionBatchCost against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Batch cost IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("costs a completed batch from the ledger value and the effective loaded rate", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresProductionStore(tx);
      const actorId = randomUUID();
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

      const created = await createProductionBatch(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        recipeVersionId: fixture.recipeVersionId,
        destinationStorageAreaId: fixture.storageAreaId,
        plannedStart: "2026-02-01T08:00:00.000Z",
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
      await completeProductionBatch(store, {
        organizationId: orgId,
        actorId,
        productionBatchId: created.productionBatchId,
        actualFinish: "2026-02-01T10:00:00.000Z",
        inputStorageAreaId: fixture.storageAreaId,
        inputs: [{ itemId: fixture.inputItemId, actualQty: "0.600000", reasonCode: "trim loss" }],
        output: { itemId: fixture.outputItemId, actualQty: "1.000000" },
        actualLabourHours: "1.50",
      });

      const costStore = createPostgresProductionBatchCostStore(tx);
      const cost = await computeProductionBatchCost(costStore, {
        organizationId: orgId,
        productionBatchId: created.productionBatchId,
      });

      // 0.6 kg × 4.0000 moving average = 2.4000 (the posted ledger value).
      expect(cost.ingredientCost).toBe("2.4000");
      // 1.50 h × 250.00 effective loaded rate = 375.0000.
      expect(cost.effectiveLoadedHourlyRate).toBe("250.00");
      expect(cost.labourCost).toBe("375.0000");
      expect(cost.allocatedOverhead).toBe("0.0000");
      expect(cost.totalBatchCost).toBe("377.4000");
      expect(cost.unitCost).toBe("377.4000");
      expect(cost.actualHours).toBe("1.50");
      // 500 g at 20.0000/kg over the approved usable output of 1 → 10.0000.
      expect(cost.theoreticalUnitCost).toBe("10.0000");
      expect(cost.varianceUnitCost).toBe("-367.4000");
      expect(cost.currency).toBe("NOK");
    });
  });
});
