import { deriveAverageUnitCost } from "@aquarela/domain";
import {
  createDb,
  goodsReceipt,
  item,
  location,
  stockMovement,
  storageArea,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listStockMovements } from "./list-stock-movements";
import { listStorageAreas } from "./list-storage-areas";
import { createPostgresInventoryStore } from "./postgres-store";
import { postStockMovement, postStockMovements } from "./post-stock-movement";
import { reverseStockMovement } from "./reverse-stock-movement";
import type { StockBalanceKey } from "./types";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

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

/**
 * Awaits `operation` expecting it to reject, then returns the underlying error
 * (drizzle wraps driver errors, so the trigger message lives on `.cause`).
 */
async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
}

interface Fixture {
  readonly unitId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly receiptId: string;
}

/** The goods_receipt is the polymorphic source the ledger's 0017 guard checks. */
async function seedFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const base = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Inventory IT" })
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
  const stocked = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `item_${suffix}`,
      sku: `SKU_${suffix}`,
      name: "Flour",
      itemType: "ingredient",
      baseUnitId: base[0]!.id,
    })
    .returning();
  const receipt = await tx
    .insert(goodsReceipt)
    .values({
      organizationId: orgId,
      storeName: "Test Store",
      locationId: createdLocation[0]!.id,
      receivedAt: new Date("2026-01-01T09:00:00.000Z"),
      status: "draft",
    })
    .returning();

  return {
    unitId: base[0]!.id,
    locationId: createdLocation[0]!.id,
    storageAreaId: area[0]!.id,
    itemId: stocked[0]!.id,
    receiptId: receipt[0]!.id,
  };
}

function balanceKey(orgId: string, fixture: Fixture): StockBalanceKey {
  return {
    organizationId: orgId,
    itemId: fixture.itemId,
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    lotId: null,
  };
}

describe.skipIf(!databaseUrl)("stock ledger against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Inventory IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the org persists.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("projects the balance and keeps the ledger sums equal to it", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      const actorId = randomUUID();

      await postStockMovement(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        movementType: "receipt",
        sourceType: "goods_receipt",
        sourceId: fixture.receiptId,
        quantityDelta: "10.000000",
        unitCost: "5.0000",
        occurredAt: "2026-01-01T10:00:00.000Z",
      });
      await postStockMovement(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: randomUUID(),
        quantityDelta: "-2.000000",
        occurredAt: "2026-01-02T10:00:00.000Z",
      });

      const balance = await store.findStockBalance(balanceKey(orgId, fixture));
      expect(balance).toMatchObject({
        quantityOnHand: "8.000000",
        valueOnHand: "40.0000",
        avgUnitCost: "5.0000",
      });

      // The projection must equal the ledger's own sum at the cutoff
      // (DATA_DICTIONARY §6 invariant: balance ≡ Σ movements). The SQL-backed
      // as-of aggregation is the same path `getStockBalanceAsOf` uses.
      const sums = await store.sumStockMovementsAsOf({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.locationId,
        asOf: new Date("2026-12-31T00:00:00.000Z"),
      });
      expect(sums).toHaveLength(1);
      expect(sums[0]).toMatchObject({
        storageAreaId: fixture.storageAreaId,
        lotId: null,
        quantityOnHand: balance!.quantityOnHand,
        valueOnHand: balance!.valueOnHand,
      });
      expect(deriveAverageUnitCost(sums[0]!.quantityOnHand, sums[0]!.valueOnHand)).toBe(
        balance!.avgUnitCost,
      );
    });
  });

  it("reads the ledger through the movement list with filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      const actorId = randomUUID();
      for (const [day, quantity] of [
        ["2026-02-01", "2.000000"],
        ["2026-01-01", "1.000000"],
        ["2026-03-01", "3.000000"],
      ] as const) {
        await postStockMovement(store, {
          organizationId: orgId,
          actorId,
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          itemId: fixture.itemId,
          movementType: "receipt",
          sourceType: "goods_receipt",
          sourceId: fixture.receiptId,
          quantityDelta: quantity,
          unitCost: "5.0000",
          occurredAt: `${day}T10:00:00.000Z`,
        });
      }

      const first = await listStockMovements(store, { organizationId: orgId, limit: 2 });
      expect(first.hasMore).toBe(true);
      expect(first.movements.map((row) => row.quantityDelta)).toEqual(["1.000000", "2.000000"]);

      const second = await listStockMovements(store, {
        organizationId: orgId,
        limit: 2,
        offset: 2,
      });
      expect(second.hasMore).toBe(false);
      expect(second.movements.map((row) => row.quantityDelta)).toEqual(["3.000000"]);

      const windowed = await listStockMovements(store, {
        organizationId: orgId,
        occurredFrom: "2026-01-15T00:00:00.000Z",
        occurredTo: "2026-02-15T00:00:00.000Z",
      });
      expect(windowed.movements.map((row) => row.quantityDelta)).toEqual(["2.000000"]);
    });
  });

  it("lists the organization's storage areas", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      const areas = await listStorageAreas(store, {
        organizationId: orgId,
        locationId: fixture.locationId,
      });
      expect(areas.map((area) => area.id)).toContain(fixture.storageAreaId);
      expect(areas.every((area) => area.organizationId === orgId)).toBe(true);
    });
  });

  it("rejects an UPDATE on the append-only ledger", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      await postStockMovement(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        movementType: "receipt",
        sourceType: "goods_receipt",
        sourceId: fixture.receiptId,
        quantityDelta: "1.000000",
        unitCost: "5.0000",
        occurredAt: "2026-01-01T10:00:00.000Z",
      });

      // No WHERE: only this transaction's row exists, and the BEFORE UPDATE
      // trigger fires on the first row regardless.
      const cause = await rejectionCause(tx.update(stockMovement).set({ reasonCode: "tamper" }));
      expect(cause.message).toMatch(/append-only/);
    });
  });

  it("posts a reversal as a new row leaving an exact balance", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      const actorId = randomUUID();

      const inbound = await postStockMovement(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        movementType: "receipt",
        sourceType: "goods_receipt",
        sourceId: fixture.receiptId,
        quantityDelta: "10.000000",
        unitCost: "5.0000",
        occurredAt: "2026-01-01T10:00:00.000Z",
      });

      const result = await reverseStockMovement(store, {
        organizationId: orgId,
        actorId,
        movementId: inbound.movementId,
        reasonCode: "wrong-purchase",
        occurredAt: "2026-01-02T10:00:00.000Z",
      });

      expect(result).toMatchObject({
        revaluationMovementId: null,
        quantityOnHand: "0.000000",
        valueOnHand: "0.0000",
        avgUnitCost: null,
      });
      expect(await store.findStockMovement(result.reversalMovementId)).toMatchObject({
        movementType: "receipt_reversal",
        reversalOfId: inbound.movementId,
        quantityDelta: "-10.000000",
        valueDelta: "-50.0000",
      });
      expect(await store.findStockBalance(balanceKey(orgId, fixture))).toMatchObject({
        quantityOnHand: "0.000000",
        valueOnHand: "0.0000",
        avgUnitCost: null,
      });
    });
  });

  it("posts a batch atomically and persists nothing when one line fails", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresInventoryStore(tx);
      const results = await postStockMovements(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        sourceType: "adjustment",
        sourceId: randomUUID(),
        occurredAt: "2026-01-01T10:00:00.000Z",
        movements: [
          {
            locationId: fixture.locationId,
            storageAreaId: fixture.storageAreaId,
            itemId: fixture.itemId,
            movementType: "count_adjustment",
            quantityDelta: "2.000000",
            unitCost: "3.0000",
            reasonCode: "opening",
          },
          {
            locationId: fixture.locationId,
            storageAreaId: fixture.storageAreaId,
            itemId: fixture.itemId,
            movementType: "count_adjustment",
            quantityDelta: "3.000000",
            unitCost: "4.0000",
            reasonCode: "opening",
          },
        ],
      });
      expect(results).toHaveLength(2);
      expect(await store.findStockBalance(balanceKey(orgId, fixture))).toMatchObject({
        quantityOnHand: "5.000000",
        valueOnHand: "18.0000",
        avgUnitCost: "3.6000",
      });
    });

    // A failing batch needs committed fixtures so a pool-bound store can open its
    // own transaction: the rollback is the thing under test. Nothing persists, so
    // only the fixture rows need cleaning up.
    const base = await client.db
      .insert(unit)
      .values({ organizationId: orgId, code: `gb_${suffix}`, dimension: "mass", isBase: true })
      .returning();
    const createdLocation = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `locb_${suffix}`, name: "Batch IT" })
      .returning();
    const area = await client.db
      .insert(storageArea)
      .values({
        organizationId: orgId,
        locationId: createdLocation[0]!.id,
        code: `areab_${suffix}`,
        name: "Dry",
        kind: "dry_store",
      })
      .returning();
    const stocked = await client.db
      .insert(item)
      .values({
        organizationId: orgId,
        code: `itemb_${suffix}`,
        sku: `SKUB_${suffix}`,
        name: "Sugar",
        itemType: "ingredient",
        baseUnitId: base[0]!.id,
      })
      .returning();

    const sourceId = randomUUID();
    try {
      await expect(
        postStockMovements(createPostgresInventoryStore(client.db), {
          organizationId: orgId,
          actorId: randomUUID(),
          sourceType: "adjustment",
          sourceId,
          occurredAt: "2026-01-01T10:00:00.000Z",
          movements: [
            {
              locationId: createdLocation[0]!.id,
              storageAreaId: area[0]!.id,
              itemId: stocked[0]!.id,
              movementType: "count_adjustment",
              quantityDelta: "1.000000",
              unitCost: "3.0000",
              reasonCode: "opening",
            },
            {
              locationId: createdLocation[0]!.id,
              storageAreaId: area[0]!.id,
              itemId: stocked[0]!.id,
              movementType: "count_adjustment",
              quantityDelta: "-100.000000",
              unitCost: null,
              reasonCode: "opening",
            },
          ],
        }),
      ).rejects.toThrow(/posting would drive stock negative/);

      const persisted = await client.pool.query<{ count: string }>(
        "select count(*)::text as count from stock_movement where source_id = $1",
        [sourceId],
      );
      expect(persisted.rows[0]!.count).toBe("0");
    } finally {
      await client.pool.query("delete from storage_area where id = $1", [area[0]!.id]);
      await client.pool.query("delete from item where id = $1", [stocked[0]!.id]);
      await client.pool.query("delete from location where id = $1", [createdLocation[0]!.id]);
      await client.pool.query("delete from unit where id = $1", [base[0]!.id]);
    }
  });
});
