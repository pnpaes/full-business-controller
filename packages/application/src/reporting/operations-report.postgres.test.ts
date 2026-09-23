import {
  createDb,
  item,
  location,
  productionBatch,
  recipe,
  recipeVersion,
  stockCount,
  stockCountLine,
  stockMovement,
  storageArea,
  unit,
  wasteEvent,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildOperationsReport, listOperationsReportRecords } from "./operations-report";
import { createPostgresReportingStore } from "./postgres-store";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const MARCH = "2026-03-01T00:00:00.000Z";
const MARCH_END = "2026-03-31T23:59:59.000Z";
const AS_OF = MARCH_END;

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

interface SeedRefs {
  readonly locationId: string;
  readonly otherLocationId: string;
  readonly unitId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly otherStorageAreaId: string;
  readonly recipeVersionId: string;
}

async function seedRefs(tx: DatabaseTransaction, orgId: string): Promise<SeedRefs> {
  const loc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Ops location A" })
    .returning();
  const otherLoc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc2_${suffix}`, name: "Ops location B" })
    .returning();
  const baseUnit = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `unit_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const stockItem = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `item_${suffix}`,
      sku: `sku_${suffix}`,
      name: "Ops ingredient",
      itemType: "ingredient",
      baseUnitId: baseUnit[0]!.id,
    })
    .returning();
  const area = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: loc[0]!.id,
      code: `area_${suffix}`,
      name: "Ops storage A",
      kind: "dry_store",
    })
    .returning();
  const otherArea = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: otherLoc[0]!.id,
      code: `area2_${suffix}`,
      name: "Ops storage B",
      kind: "dry_store",
    })
    .returning();
  const recipeRow = await tx
    .insert(recipe)
    .values({ organizationId: orgId, code: `recipe_${suffix}`, name: "Ops dough" })
    .returning();
  const version = await tx
    .insert(recipeVersion)
    .values({
      recipeId: recipeRow[0]!.id,
      versionNo: 1,
      state: "approved",
      plannedInputQty: "100",
      plannedOutputQty: "100",
      approvedUsableOutput: "90",
      yieldRate: "0.9",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      approvedBy: randomUUID(),
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning();

  return {
    locationId: loc[0]!.id,
    otherLocationId: otherLoc[0]!.id,
    unitId: baseUnit[0]!.id,
    itemId: stockItem[0]!.id,
    storageAreaId: area[0]!.id,
    otherStorageAreaId: otherArea[0]!.id,
    recipeVersionId: version[0]!.id,
  };
}

interface MovementSeed {
  readonly refs: SeedRefs;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly movementType: string;
  readonly quantityDelta: string;
  readonly valueDelta: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
}

async function seedMovement(tx: DatabaseTransaction, orgId: string, seed: MovementSeed) {
  await tx.insert(stockMovement).values({
    organizationId: orgId,
    locationId: seed.locationId,
    storageAreaId: seed.storageAreaId,
    itemId: seed.refs.itemId,
    movementType: seed.movementType,
    quantityDelta: seed.quantityDelta,
    unitId: seed.refs.unitId,
    valueDelta: seed.valueDelta,
    currency: "NOK",
    sourceType: seed.sourceType,
    sourceId: seed.sourceId,
    occurredAt: new Date(seed.occurredAt),
    postedBy: randomUUID(),
  });
}

async function seedApprovedCount(
  tx: DatabaseTransaction,
  orgId: string,
  refs: SeedRefs,
  values: {
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly cutoff: string;
    readonly varianceQty: string;
    readonly status?: string;
  },
): Promise<string> {
  const count = await tx
    .insert(stockCount)
    .values({
      organizationId: orgId,
      locationId: values.locationId,
      cutoff: new Date(values.cutoff),
      status: values.status ?? "approved",
      approvedBy: (values.status ?? "approved") === "approved" ? randomUUID() : null,
      approvedAt: (values.status ?? "approved") === "approved" ? new Date(values.cutoff) : null,
    })
    .returning();
  await tx.insert(stockCountLine).values({
    stockCountId: count[0]!.id,
    itemId: refs.itemId,
    storageAreaId: values.storageAreaId,
    expectedQty: "10",
    countedQty: "10",
    varianceQty: values.varianceQty,
    reasonCode: "test",
  });
  return count[0]!.id;
}

describe.skipIf(!databaseUrl)("operational reporting against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Ops IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("sums the as-of stock value by location, excluding future movements", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "revaluation",
        quantityDelta: "10",
        valueDelta: "500.0000",
        sourceType: "revaluation",
        sourceId: randomUUID(),
        occurredAt: MARCH,
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.otherLocationId,
        storageAreaId: refs.otherStorageAreaId,
        movementType: "revaluation",
        quantityDelta: "4",
        valueDelta: "20.0000",
        sourceType: "revaluation",
        sourceId: randomUUID(),
        occurredAt: "2026-03-05T00:00:00.000Z",
      });
      // After the as-of instant: must be excluded.
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "revaluation",
        quantityDelta: "1",
        valueDelta: "999.0000",
        sourceType: "revaluation",
        sourceId: randomUUID(),
        occurredAt: "2026-04-05T00:00:00.000Z",
      });

      const all = await store.sumStockValueByLocationAsOf({
        organizationId: orgId,
        asOf: AS_OF,
      });
      const locationA = all.find((row) => row.locationId === refs.locationId);
      const locationB = all.find((row) => row.locationId === refs.otherLocationId);
      expect(locationA).toMatchObject({ locationName: "Ops location A", valueOnHand: "500.0000" });
      expect(locationB).toMatchObject({ valueOnHand: "20.0000" });

      const scoped = await store.sumStockValueByLocationAsOf({
        organizationId: orgId,
        asOf: AS_OF,
        locationIds: [refs.otherLocationId],
      });
      expect(scoped.map((row) => row.locationId)).toEqual([refs.otherLocationId]);
    });
  });

  it("sums approved count variance and the booked adjustment value by location", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const countA = await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        cutoff: "2026-03-15T12:00:00.000Z",
        varianceQty: "-3.500000",
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "count_adjustment",
        quantityDelta: "-3.5",
        valueDelta: "-120.0000",
        sourceType: "stock_count",
        sourceId: countA,
        occurredAt: "2026-03-15T12:00:00.000Z",
      });
      // A draft count in the window is not aggregated.
      await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        cutoff: "2026-03-16T12:00:00.000Z",
        varianceQty: "99.000000",
        status: "draft",
      });
      // An approved count outside the window is excluded.
      await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.otherLocationId,
        storageAreaId: refs.otherStorageAreaId,
        cutoff: "2026-04-02T12:00:00.000Z",
        varianceQty: "99.000000",
      });
      await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.otherLocationId,
        storageAreaId: refs.otherStorageAreaId,
        cutoff: "2026-03-20T12:00:00.000Z",
        varianceQty: "1.000000",
      });

      const rows = await store.sumStockCountVariance({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      const locationA = rows.find((row) => row.locationId === refs.locationId);
      const locationB = rows.find((row) => row.locationId === refs.otherLocationId);
      expect(locationA).toMatchObject({
        counts: 1,
        varianceQty: "-3.500000",
        adjustmentValue: "-120.0000",
      });
      expect(locationB).toMatchObject({
        counts: 1,
        varianceQty: "1.000000",
        adjustmentValue: "0.0000",
      });
    });
  });

  it("attributes a count-sourced movement only to its source count's location", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      // An approved count at location A (no movement of its own).
      await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        cutoff: "2026-03-15T12:00:00.000Z",
        varianceQty: "-0.500000",
      });
      // An approved count at location B with its own correctly-located movement.
      const countB = await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.otherLocationId,
        storageAreaId: refs.otherStorageAreaId,
        cutoff: "2026-03-15T12:00:00.000Z",
        varianceQty: "-1.000000",
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.otherLocationId,
        storageAreaId: refs.otherStorageAreaId,
        movementType: "count_adjustment",
        quantityDelta: "-0.05",
        valueDelta: "-5.0000",
        sourceType: "stock_count",
        sourceId: countB,
        occurredAt: "2026-03-15T13:00:00.000Z",
      });
      // A movement posted at location A but sourced to the count at location B:
      // it must not be attributed to location A's count group.
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "count_adjustment",
        quantityDelta: "-1",
        valueDelta: "-120.0000",
        sourceType: "stock_count",
        sourceId: countB,
        occurredAt: "2026-03-15T14:00:00.000Z",
      });

      const rows = await store.sumStockCountVariance({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      const locationA = rows.find((row) => row.locationId === refs.locationId);
      const locationB = rows.find((row) => row.locationId === refs.otherLocationId);
      expect(locationA).toMatchObject({
        counts: 1,
        varianceQty: "-0.500000",
        adjustmentValue: "0.0000",
      });
      expect(locationB).toMatchObject({ counts: 1, adjustmentValue: "-5.0000" });
    });
  });

  it("sums completed-batch yield by location and recipe version", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const batch = await tx
        .insert(productionBatch)
        .values({
          organizationId: orgId,
          locationId: refs.locationId,
          recipeVersionId: refs.recipeVersionId,
          status: "completed",
          actualStart: new Date("2026-03-10T08:00:00.000Z"),
          actualFinish: new Date("2026-03-10T10:00:00.000Z"),
          plannedOutputQty: "100",
          actualOutputQty: "90",
          yieldVariancePct: "-0.100000",
        })
        .returning();
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "production_consumption",
        quantityDelta: "-10",
        valueDelta: "-200.0000",
        sourceType: "production_batch",
        sourceId: batch[0]!.id,
        occurredAt: "2026-03-10T09:00:00.000Z",
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "production_output",
        quantityDelta: "9",
        valueDelta: "180.0000",
        sourceType: "production_batch",
        sourceId: batch[0]!.id,
        occurredAt: "2026-03-10T10:00:00.000Z",
      });
      // A batch finished outside the window is excluded.
      await tx.insert(productionBatch).values({
        organizationId: orgId,
        locationId: refs.locationId,
        recipeVersionId: refs.recipeVersionId,
        status: "completed",
        actualStart: new Date("2026-04-10T08:00:00.000Z"),
        actualFinish: new Date("2026-04-10T10:00:00.000Z"),
        plannedOutputQty: "50",
        actualOutputQty: "50",
      });

      const rows = await store.sumProductionYield({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        locationId: refs.locationId,
        recipeVersionId: refs.recipeVersionId,
        recipeName: "Ops dough",
        batches: 1,
        plannedOutput: "100.000000",
        actualOutput: "90.000000",
        inputValue: "200.0000",
        outputValue: "180.0000",
      });

      const report = await buildOperationsReport(store, {
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
        grain: "month",
        asOf: AS_OF,
      });
      expect(report.production.totals).toMatchObject({
        batches: 1,
        yieldVariancePct: "-0.100000",
        yieldRatio: "0.900000",
      });
    });
  });

  it("sums the production input value as Σ|consumption value_delta|, not |net|", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const batch = await tx
        .insert(productionBatch)
        .values({
          organizationId: orgId,
          locationId: refs.locationId,
          recipeVersionId: refs.recipeVersionId,
          status: "completed",
          actualStart: new Date("2026-03-10T08:00:00.000Z"),
          actualFinish: new Date("2026-03-10T10:00:00.000Z"),
          plannedOutputQty: "100",
          actualOutputQty: "90",
        })
        .returning();
      // Mixed-sign consumption in one batch: Σ|Δ| = 250, while |net| would be 150.
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "production_consumption",
        quantityDelta: "-10",
        valueDelta: "-200.0000",
        sourceType: "production_batch",
        sourceId: batch[0]!.id,
        occurredAt: "2026-03-10T09:00:00.000Z",
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "production_consumption",
        quantityDelta: "2",
        valueDelta: "50.0000",
        sourceType: "production_batch",
        sourceId: batch[0]!.id,
        occurredAt: "2026-03-10T09:30:00.000Z",
      });

      const rows = await store.sumProductionYield({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ inputValue: "250.0000", outputValue: "0.0000" });
    });
  });

  it("reports zero input/output value for a completed batch with no movements", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      await tx.insert(productionBatch).values({
        organizationId: orgId,
        locationId: refs.locationId,
        recipeVersionId: refs.recipeVersionId,
        status: "completed",
        actualStart: new Date("2026-03-10T08:00:00.000Z"),
        actualFinish: new Date("2026-03-10T10:00:00.000Z"),
        plannedOutputQty: "100",
        actualOutputQty: "90",
      });

      const rows = await store.sumProductionYield({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        batches: 1,
        inputValue: "0.0000",
        outputValue: "0.0000",
      });
    });
  });

  it("sums two production_output movements into the output value", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const batch = await tx
        .insert(productionBatch)
        .values({
          organizationId: orgId,
          locationId: refs.locationId,
          recipeVersionId: refs.recipeVersionId,
          status: "completed",
          actualStart: new Date("2026-03-10T08:00:00.000Z"),
          actualFinish: new Date("2026-03-10T10:00:00.000Z"),
          plannedOutputQty: "100",
          actualOutputQty: "90",
        })
        .returning();
      for (const valueDelta of ["180.0000", "20.0000"]) {
        await seedMovement(tx, orgId, {
          refs,
          locationId: refs.locationId,
          storageAreaId: refs.storageAreaId,
          movementType: "production_output",
          quantityDelta: "9",
          valueDelta,
          sourceType: "production_batch",
          sourceId: batch[0]!.id,
          occurredAt: "2026-03-10T10:00:00.000Z",
        });
      }

      const rows = await store.sumProductionYield({
        organizationId: orgId,
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outputValue: "200.0000", inputValue: "0.0000" });
    });
  });

  it("sums waste by the DEC-018 stage, valuing moving_average events only", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const insertWaste = (
        locationId: string,
        storageAreaId: string,
        overrides: Partial<typeof wasteEvent.$inferInsert>,
      ) =>
        tx.insert(wasteEvent).values({
          organizationId: orgId,
          locationId,
          storageAreaId,
          itemId: refs.itemId,
          quantity: "0.5",
          unitId: refs.unitId,
          stage: "preparation",
          reasonCode: "trim",
          valueMethod: "moving_average",
          value: "30.0000",
          currency: "NOK",
          occurredAt: new Date("2026-03-12T12:00:00.000Z"),
          actorId: randomUUID(),
          ...overrides,
        });

      // Item-only, moving_average: valued.
      await insertWaste(refs.locationId, refs.storageAreaId, {});
      // Item-only, non-moving_average: counts as an event, excluded from value.
      await insertWaste(refs.locationId, refs.storageAreaId, {
        valueMethod: "manual",
        value: "999.0000",
      });
      // A different stage, unvalued.
      await insertWaste(refs.otherLocationId, refs.otherStorageAreaId, {
        stage: "storage_expiry",
        valueMethod: "moving_average",
        value: null,
      });
      // Outside the window.
      await insertWaste(refs.locationId, refs.storageAreaId, {
        occurredAt: new Date("2026-04-12T12:00:00.000Z"),
      });
      // Exactly at the exclusive `to` bound: excluded (half-open `[from, to)`).
      await insertWaste(refs.locationId, refs.storageAreaId, {
        occurredAt: new Date(MARCH_END),
        value: "777.0000",
      });

      const rows = await store.sumWasteByStage({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
      });
      const preparation = rows.find((row) => row.stage === "preparation");
      const storageExpiry = rows.find((row) => row.stage === "storage_expiry");
      expect(preparation).toMatchObject({
        events: 2,
        quantity: "1.000000",
        value: "30.0000",
      });
      expect(storageExpiry).toMatchObject({ events: 1, quantity: "0.500000", value: null });
    });
  });

  it("lists the drill-down records for each section with a conservative cap", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const count = await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        cutoff: "2026-03-15T12:00:00.000Z",
        varianceQty: "-3.500000",
      });
      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "count_adjustment",
        quantityDelta: "-3.5",
        valueDelta: "-120.0000",
        sourceType: "stock_count",
        sourceId: count,
        occurredAt: "2026-03-15T12:00:00.000Z",
      });
      const batch = await tx
        .insert(productionBatch)
        .values({
          organizationId: orgId,
          locationId: refs.locationId,
          recipeVersionId: refs.recipeVersionId,
          status: "completed",
          actualStart: new Date("2026-03-10T08:00:00.000Z"),
          actualFinish: new Date("2026-03-10T10:00:00.000Z"),
          plannedOutputQty: "100",
          actualOutputQty: "90",
          yieldVariancePct: "-0.100000",
        })
        .returning();
      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        itemId: refs.itemId,
        quantity: "0.5",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "trim",
        valueMethod: "moving_average",
        value: "30.0000",
        currency: "NOK",
        occurredAt: new Date("2026-03-12T12:00:00.000Z"),
        actorId: randomUUID(),
      });

      const stockValue = await listOperationsReportRecords(store, {
        organizationId: orgId,
        section: "stock_value",
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        asOf: AS_OF,
        limit: 10,
        offset: 0,
      });
      expect(stockValue.records.map((record) => record.section)).toEqual(["stock_value"]);
      expect(stockValue.records[0]).toMatchObject({
        movementType: "count_adjustment",
        itemName: "Ops ingredient",
        locationName: "Ops location A",
      });

      const variance = await listOperationsReportRecords(store, {
        organizationId: orgId,
        section: "stock_variance",
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
        grain: "month",
        limit: 10,
        offset: 0,
      });
      expect(variance.records[0]).toMatchObject({
        section: "stock_variance",
        stockCountId: count,
        varianceQty: "-3.500000",
      });

      const production = await listOperationsReportRecords(store, {
        organizationId: orgId,
        section: "production",
        from: MARCH,
        to: "2026-04-01T00:00:00.000Z",
        grain: "month",
        limit: 10,
        offset: 0,
      });
      expect(production.records[0]).toMatchObject({
        section: "production",
        id: batch[0]!.id,
        recipeName: "Ops dough",
        yieldVariancePct: "-0.100000",
      });

      const waste = await listOperationsReportRecords(store, {
        organizationId: orgId,
        section: "waste",
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        limit: 1,
        offset: 0,
      });
      expect(waste.records[0]).toMatchObject({ section: "waste", stage: "preparation" });

      // A second waste event makes the limit-1 page truncate.
      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        itemId: refs.itemId,
        quantity: "0.5",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "trim",
        valueMethod: "moving_average",
        value: "1.0000",
        currency: "NOK",
        occurredAt: new Date("2026-03-13T12:00:00.000Z"),
        actorId: randomUUID(),
      });
      const truncated = await listOperationsReportRecords(store, {
        organizationId: orgId,
        section: "waste",
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        limit: 1,
        offset: 0,
      });
      expect(truncated.records).toHaveLength(1);
      expect(truncated.truncated).toBe(true);
    });
  });

  it("does not read another organization's operational facts", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);
      const otherOrgId = `00000000-0000-4000-8000-${suffix.padEnd(12, "0").slice(0, 12)}`;

      await seedMovement(tx, orgId, {
        refs,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        movementType: "revaluation",
        quantityDelta: "1",
        valueDelta: "5.0000",
        sourceType: "revaluation",
        sourceId: randomUUID(),
        occurredAt: MARCH,
      });

      const rows = await store.sumStockValueByLocationAsOf({
        organizationId: otherOrgId,
        asOf: AS_OF,
      });
      expect(rows).toHaveLength(0);
    });
  });

  it("does not read another organization's variance, production or waste rows", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);
      const otherOrgId = `00000000-0000-4000-8000-${suffix.padEnd(12, "0").slice(0, 12)}`;

      // In-scope facts in the real organization, to prove the read is not just empty.
      await seedApprovedCount(tx, orgId, refs, {
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        cutoff: "2026-03-15T12:00:00.000Z",
        varianceQty: "-1.000000",
      });
      await tx.insert(productionBatch).values({
        organizationId: orgId,
        locationId: refs.locationId,
        recipeVersionId: refs.recipeVersionId,
        status: "completed",
        actualStart: new Date("2026-03-10T08:00:00.000Z"),
        actualFinish: new Date("2026-03-10T10:00:00.000Z"),
        plannedOutputQty: "100",
        actualOutputQty: "90",
      });
      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        itemId: refs.itemId,
        quantity: "0.5",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "trim",
        valueMethod: "moving_average",
        value: "30.0000",
        currency: "NOK",
        occurredAt: new Date("2026-03-12T12:00:00.000Z"),
        actorId: randomUUID(),
      });

      expect(
        await store.sumStockCountVariance({
          organizationId: otherOrgId,
          from: MARCH,
          to: "2026-04-01T00:00:00.000Z",
        }),
      ).toHaveLength(0);
      expect(
        await store.sumProductionYield({
          organizationId: otherOrgId,
          from: MARCH,
          to: "2026-04-01T00:00:00.000Z",
        }),
      ).toHaveLength(0);
      expect(
        await store.sumWasteByStage({
          organizationId: otherOrgId,
          from: MARCH,
          to: MARCH_END,
        }),
      ).toHaveLength(0);
    });
  });
});
