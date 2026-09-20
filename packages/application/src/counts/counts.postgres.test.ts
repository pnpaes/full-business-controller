import {
  createDb,
  goodsReceipt,
  item,
  location,
  storageArea,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postStockMovement } from "../inventory";
import { approveStockCount } from "./approve-stock-count";
import { createPostgresCountStore } from "./postgres-store";
import { getStockCount } from "./get-stock-count";
import { openStockCount } from "./open-stock-count";
import { recordCountedLines } from "./record-counted-lines";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const CUTOFF = "2026-12-31T00:00:00.000Z";

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
  readonly unitId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly receiptId: string;
}

async function seedFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const base = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Counts IT" })
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
      currentCost: "5.0000",
    })
    .returning();
  // The ledger's 0017 guard requires a goods_receipt movement to reference a
  // real receipt in the same organization; this is the opening stock source.
  const receipt = await tx
    .insert(goodsReceipt)
    .values({
      organizationId: orgId,
      storeName: "Counts IT Store",
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

describe.skipIf(!databaseUrl)("counts against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Counts IT ${suffix}`],
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

  it("opens, records and approves a count through the real adapter", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresCountStore(tx);
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

      const opened = await openStockCount(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        cutoff: CUTOFF,
        blind: false,
      });
      expect(opened.lineCount).toBe(1);

      await recordCountedLines(store, {
        organizationId: orgId,
        actorId,
        stockCountId: opened.stockCountId,
        lines: [
          {
            itemId: fixture.itemId,
            storageAreaId: fixture.storageAreaId,
            countedQty: "8.000000",
          },
        ],
      });

      const approved = await approveStockCount(store, {
        organizationId: orgId,
        actorId,
        stockCountId: opened.stockCountId,
      });
      expect(approved).toMatchObject({ varianceCount: 1, status: "approved" });
      expect(approved.movementIds).toHaveLength(1);

      const movement = await store.findStockMovement(approved.movementIds[0]!);
      expect(movement).toMatchObject({
        movementType: "count_adjustment",
        sourceType: "stock_count",
        sourceId: opened.stockCountId,
        quantityDelta: "-2.000000",
        unitCost: "5.0000",
        valueDelta: "-10.0000",
      });

      const detail = await getStockCount(store, {
        organizationId: orgId,
        stockCountId: opened.stockCountId,
      });
      expect(detail?.count).toMatchObject({ status: "approved", approvedBy: actorId });
      expect(detail?.lines[0]).toMatchObject({
        expectedQty: "10.000000",
        countedQty: "8.000000",
        varianceQty: "-2.000000",
      });
    });
  });
});
