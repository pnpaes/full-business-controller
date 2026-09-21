import {
  createDb,
  dataQualityException,
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

import { approveStockTransfer } from "./approve-stock-transfer";
import { createPostgresTransferStore } from "./postgres-store";
import { getStockTransfer } from "./reads";
import { dispatchStockTransfer } from "./dispatch-stock-transfer";
import { receiveStockTransfer } from "./receive-stock-transfer";
import { requestStockTransfer } from "./request-stock-transfer";
import type { NewDataQualityExceptionRecord, TransferStore } from "./types";

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

interface Fixture {
  readonly unitId: string;
  readonly fromLocationId: string;
  readonly fromStorageAreaId: string;
  readonly toLocationId: string;
  readonly toStorageAreaId: string;
  readonly transitLocationId: string;
  readonly transitStorageAreaId: string;
  readonly itemId: string;
}

async function seedFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const baseUnit = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const from = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `from_${suffix}`, name: "Transfers IT from" })
    .returning();
  const to = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `to_${suffix}`, name: "Transfers IT to" })
    .returning();
  const transit = await tx
    .insert(location)
    .values({
      organizationId: orgId,
      code: `transit_${suffix}`,
      name: "Transfers IT transit",
      kind: "virtual_transit",
    })
    .returning();
  const fromArea = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: from[0]!.id,
      code: `from_area_${suffix}`,
      name: "From dry store",
      kind: "dry_store",
    })
    .returning();
  const toArea = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: to[0]!.id,
      code: `to_area_${suffix}`,
      name: "To dry store",
      kind: "dry_store",
    })
    .returning();
  const transitArea = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: transit[0]!.id,
      code: `transit_area_${suffix}`,
      name: "In transit",
      kind: "transit",
      isTransit: true,
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
      baseUnitId: baseUnit[0]!.id,
      inventoryPolicy: "stocked",
    })
    .returning();

  return {
    unitId: baseUnit[0]!.id,
    fromLocationId: from[0]!.id,
    fromStorageAreaId: fromArea[0]!.id,
    toLocationId: to[0]!.id,
    toStorageAreaId: toArea[0]!.id,
    transitLocationId: transit[0]!.id,
    transitStorageAreaId: transitArea[0]!.id,
    itemId: stocked[0]!.id,
  };
}

/** Posts an opening balance through the real ledger (source type `adjustment`). */
async function seedOpeningStock(
  store: ReturnType<typeof createPostgresTransferStore>,
  orgId: string,
  fixture: Fixture,
  actorId: string,
): Promise<void> {
  await postStockMovement(store, {
    organizationId: orgId,
    actorId,
    locationId: fixture.fromLocationId,
    storageAreaId: fixture.fromStorageAreaId,
    itemId: fixture.itemId,
    movementType: "count_adjustment",
    sourceType: "adjustment",
    sourceId: randomUUID(),
    quantityDelta: "100.000000",
    unitCost: "0.2500",
    occurredAt: "2026-09-01T08:00:00.000Z",
    reasonCode: "opening balance",
  });
}

describe.skipIf(!databaseUrl)("transfers against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Transfers IT ${suffix}`],
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

  it("dispatches and receives through the real adapter, stamping transfer_id", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresTransferStore(tx);
      const actorId = randomUUID();
      await seedOpeningStock(store, orgId, fixture, actorId);

      const { transferId } = await requestStockTransfer(store, {
        organizationId: orgId,
        actorId,
        fromLocationId: fixture.fromLocationId,
        fromStorageAreaId: fixture.fromStorageAreaId,
        toLocationId: fixture.toLocationId,
        toStorageAreaId: fixture.toStorageAreaId,
      });
      await approveStockTransfer(store, { organizationId: orgId, actorId, transferId });
      await dispatchStockTransfer(store, {
        organizationId: orgId,
        actorId,
        transferId,
        lines: [{ itemId: fixture.itemId, quantity: "10.000000" }],
        occurredAt: "2026-09-02T08:00:00.000Z",
      });

      const dispatched = await store.findStockTransfer({ organizationId: orgId, transferId });
      expect(dispatched).toMatchObject({ status: "dispatched" });
      expect(dispatched?.dispatchMovementId).not.toBeNull();

      const dispatchLegs = await store.listStockMovementsByTransferId({
        organizationId: orgId,
        transferId,
      });
      expect(dispatchLegs).toHaveLength(2);
      expect(dispatchLegs.every((movement) => movement.transferId === transferId)).toBe(true);

      await receiveStockTransfer(store, {
        organizationId: orgId,
        actorId,
        transferId,
        received: [{ itemId: fixture.itemId, quantity: "10.000000" }],
        occurredAt: "2026-09-03T08:00:00.000Z",
      });

      const received = await store.findStockTransfer({ organizationId: orgId, transferId });
      expect(received).toMatchObject({ status: "received" });
      expect(received?.receiptMovementId).not.toBeNull();
      expect(received?.discrepancyNote).toBeNull();

      // A clean receipt records no data-quality exception (DEC-080).
      const exceptions = await tx.select().from(dataQualityException);
      expect(exceptions.filter((row) => row.entityId === transferId)).toEqual([]);

      const legs = await store.listStockMovementsByTransferId({
        organizationId: orgId,
        transferId,
      });
      expect(legs).toHaveLength(4);
      expect(legs.every((movement) => movement.transferId === transferId)).toBe(true);

      const source = await store.findStockBalance({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.fromLocationId,
        storageAreaId: fixture.fromStorageAreaId,
        lotId: null,
      });
      const transit = await store.findStockBalance({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.transitLocationId,
        storageAreaId: fixture.transitStorageAreaId,
        lotId: null,
      });
      const destination = await store.findStockBalance({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.toLocationId,
        storageAreaId: fixture.toStorageAreaId,
        lotId: null,
      });
      expect(source?.quantityOnHand).toBe("90.000000");
      expect(transit?.quantityOnHand).toBe("0.000000");
      expect(transit?.valueOnHand).toBe("0.0000");
      expect(destination?.quantityOnHand).toBe("10.000000");
      expect(destination?.valueOnHand).toBe("2.5000");

      const detail = await getStockTransfer(store, { organizationId: orgId, transferId });
      expect(detail?.hasDiscrepancy).toBe(false);
      expect(detail?.lines[0]).toMatchObject({
        dispatchedQuantity: "10.000000",
        receivedQuantity: "10.000000",
      });
    });
  });

  it("records a short receipt as a discrepancy with a note", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresTransferStore(tx);
      const actorId = randomUUID();
      await seedOpeningStock(store, orgId, fixture, actorId);

      const { transferId } = await requestStockTransfer(store, {
        organizationId: orgId,
        actorId,
        fromLocationId: fixture.fromLocationId,
        fromStorageAreaId: fixture.fromStorageAreaId,
        toLocationId: fixture.toLocationId,
        toStorageAreaId: fixture.toStorageAreaId,
      });
      await approveStockTransfer(store, { organizationId: orgId, actorId, transferId });
      await dispatchStockTransfer(store, {
        organizationId: orgId,
        actorId,
        transferId,
        lines: [{ itemId: fixture.itemId, quantity: "10.000000" }],
      });

      const result = await receiveStockTransfer(store, {
        organizationId: orgId,
        actorId,
        transferId,
        received: [{ itemId: fixture.itemId, quantity: "8.000000" }],
      });
      expect(result.hasDiscrepancy).toBe(true);
      expect(result.discrepancyNote).toMatch(/differs from dispatched/);

      // Exactly one transfer_discrepancy exception, in the same transaction as
      // the header update and the ledger posting (DEC-080).
      const exceptions = (await tx.select().from(dataQualityException)).filter(
        (row) => row.entityId === transferId,
      );
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0]).toMatchObject({
        organizationId: orgId,
        ruleCode: "transfer_discrepancy",
        severity: "high",
        entityType: "stock_transfer",
        status: "open",
        resolution: null,
      });
      expect(exceptions[0]?.detectedAt).toBeInstanceOf(Date);

      const transit = await store.findStockBalance({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.transitLocationId,
        storageAreaId: fixture.transitStorageAreaId,
        lotId: null,
      });
      expect(transit?.quantityOnHand).toBe("2.000000");
      expect(transit?.valueOnHand).toBe("0.5000");
    });
  });

  it("rolls the exception back when the receive fails after detection", async () => {
    // The exception is created as soon as a discrepancy is detected, before the
    // received-line loop can reject an item that was never dispatched. That
    // rejection aborts the transaction, so the exception must not survive.
    let createdId: string | undefined;
    await expect(
      client.db.transaction(async (tx) => {
        const fixture = await seedFixture(tx, orgId);
        const base = createPostgresTransferStore(tx);
        const actorId = randomUUID();
        await seedOpeningStock(base, orgId, fixture, actorId);

        const otherItem = await tx
          .insert(item)
          .values({
            organizationId: orgId,
            code: `other_${suffix}`,
            sku: `OTHER_${suffix}`,
            name: "Sugar",
            itemType: "ingredient",
            baseUnitId: fixture.unitId,
            inventoryPolicy: "stocked",
          })
          .returning();

        const store: TransferStore = {
          ...base,
          // `withTransaction` normally builds a fresh adapter, so propagate this
          // wrapper to observe the create the command performs inside it.
          withTransaction: (fn) => base.withTransaction(() => fn(store)),
          createDataQualityException: async (input: NewDataQualityExceptionRecord) => {
            const row = await base.createDataQualityException(input);
            createdId = row.id;
            return row;
          },
        };

        const { transferId } = await requestStockTransfer(base, {
          organizationId: orgId,
          actorId,
          fromLocationId: fixture.fromLocationId,
          fromStorageAreaId: fixture.fromStorageAreaId,
          toLocationId: fixture.toLocationId,
          toStorageAreaId: fixture.toStorageAreaId,
        });
        await approveStockTransfer(base, { organizationId: orgId, actorId, transferId });
        await dispatchStockTransfer(base, {
          organizationId: orgId,
          actorId,
          transferId,
          lines: [{ itemId: fixture.itemId, quantity: "10.000000" }],
        });

        await receiveStockTransfer(store, {
          organizationId: orgId,
          actorId,
          transferId,
          received: [
            { itemId: fixture.itemId, quantity: "8.000000" },
            { itemId: otherItem[0]!.id, quantity: "1.000000" },
          ],
        });
      }),
    ).rejects.toThrow(/was not dispatched/);

    expect(createdId).toBeDefined();
    const rows = await client.pool.query<{ id: string }>(
      "select id from data_quality_exception where id = $1",
      [createdId!],
    );
    expect(rows.rows).toEqual([]);
  });
});
