import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import {
  goodsReceipt,
  item,
  location,
  organization,
  salesLine,
  salesTransaction,
  stockBalance,
  stockLot,
  stockMovement,
  storageArea,
  unit,
} from "../schema";
import {
  createStorageArea,
  findLocationById,
  findOrganizationById,
  findOrCreateStockLot,
  findStockBalance,
  findStockLot,
  findStockMovement,
  findStockMovementByIdempotencyKey,
  findStockMovementReversal,
  findStorageArea,
  findStorageAreaByCode,
  listStockMovements,
  lockOrCreateStockBalance,
  saveStockBalance,
  sumStockMovementsAsOf,
} from "./inventory";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestStockLot,
  createTestStockMovement,
  createTestStorageArea,
  createTestUnit,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("inventory repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let unitId: string;
  let itemId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
    const baseUnit = await createTestUnit(client.db, orgId);
    unitId = baseUnit.id;
    const testItem = await createTestItem(client.db, orgId, baseUnit.id);
    itemId = testItem.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the org, its location, unit
      // and item persist and must be removed (FK-safe order).
      await client.db.delete(item).where(eq(item.id, itemId));
      await client.db.delete(unit).where(eq(unit.id, unitId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("locks or creates a zero balance row exactly once", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const key = {
        organizationId: orgId,
        itemId,
        locationId,
        storageAreaId: area.id,
        lotId: null,
      };

      const first = await lockOrCreateStockBalance(tx, key, at("2026-03-01T00:00:00.000Z"));
      expect(first.quantityOnHand).toBe("0.000000");
      expect(first.valueOnHand).toBe("0.0000");
      expect(first.avgUnitCost).toBeNull();

      // A second call conflicts, the insert is skipped and the same row is locked.
      const second = await lockOrCreateStockBalance(tx, key, at("2026-03-02T00:00:00.000Z"));
      expect(second.id).toBe(first.id);
      expect(second.asOf.toISOString()).toBe(first.asOf.toISOString());

      const rows = await tx.select().from(stockBalance).where(eq(stockBalance.itemId, itemId));
      expect(rows).toHaveLength(1);
    });
  });

  it("distinguishes a null lot from a specific lot in findStockBalance", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const lot = await createTestStockLot(tx, orgId, itemId, locationId);
      const nullKey = {
        organizationId: orgId,
        itemId,
        locationId,
        storageAreaId: area.id,
        lotId: null,
      };
      const lotKey = { ...nullKey, lotId: lot.id };

      await lockOrCreateStockBalance(tx, nullKey, at("2026-03-01T00:00:00.000Z"));
      await lockOrCreateStockBalance(tx, lotKey, at("2026-03-01T00:00:00.000Z"));

      const nullBalance = await findStockBalance(tx, nullKey);
      const lotBalance = await findStockBalance(tx, lotKey);
      expect(nullBalance?.lotId).toBeNull();
      expect(lotBalance?.lotId).toBe(lot.id);
      expect(nullBalance?.id).not.toBe(lotBalance?.id);
    });
  });

  it("saves the locked balance row in place", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const key = {
        organizationId: orgId,
        itemId,
        locationId,
        storageAreaId: area.id,
        lotId: null,
      };
      const created = await lockOrCreateStockBalance(tx, key, at("2026-03-01T00:00:00.000Z"));
      const saved = await saveStockBalance(tx, key, {
        quantityOnHand: "5",
        valueOnHand: "10.5",
        avgUnitCost: "2.1",
        asOf: at("2026-03-05T00:00:00.000Z"),
      });
      expect(saved.id).toBe(created.id);
      expect(saved.quantityOnHand).toBe("5.000000");
      expect(saved.valueOnHand).toBe("10.5000");
      expect(saved.avgUnitCost).toBe("2.1000");
      expect((await findStockBalance(tx, key))?.quantityOnHand).toBe("5.000000");
    });
  });

  it("rejects an UPDATE to a posted stock movement (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const movement = await createTestStockMovement(tx, orgId, {
        itemId,
        locationId,
        storageAreaId: area.id,
        unitId,
      });
      const cause = await rejectionCause(
        tx
          .update(stockMovement)
          .set({ reasonCode: "tamper" })
          .where(eq(stockMovement.id, movement.id)),
      );
      expect(cause.message).toMatch(/append-only/);
    });
  });

  it("rejects a DELETE of a posted stock movement (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const movement = await createTestStockMovement(tx, orgId, {
        itemId,
        locationId,
        storageAreaId: area.id,
        unitId,
      });
      const cause = await rejectionCause(
        tx.delete(stockMovement).where(eq(stockMovement.id, movement.id)),
      );
      expect(cause.message).toMatch(/append-only/);
    });
  });

  it("finds a movement by id and by idempotency key", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const idempotencyKey = uniqueName("idem");
      const movement = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        { idempotencyKey },
      );
      expect((await findStockMovement(tx, movement.id))?.id).toBe(movement.id);
      expect((await findStockMovementByIdempotencyKey(tx, orgId, idempotencyKey))?.id).toBe(
        movement.id,
      );
      expect(
        await findStockMovementByIdempotencyKey(tx, orgId, uniqueName("missing")),
      ).toBeUndefined();
    });
  });

  it("scopes the idempotency key per organization", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherUnit = await createTestUnit(tx, otherOrgId);
      const otherItem = await createTestItem(tx, otherOrgId, otherUnit.id);
      const otherArea = await createTestStorageArea(tx, otherOrgId, otherLocation.id);
      const key = uniqueName("idem");

      const first = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        { idempotencyKey: key },
      );
      const second = await createTestStockMovement(
        tx,
        otherOrgId,
        {
          itemId: otherItem.id,
          locationId: otherLocation.id,
          storageAreaId: otherArea.id,
          unitId: otherUnit.id,
        },
        { idempotencyKey: key },
      );
      expect(second.id).not.toBe(first.id);
      expect((await findStockMovementByIdempotencyKey(tx, orgId, key))?.id).toBe(first.id);
      expect((await findStockMovementByIdempotencyKey(tx, otherOrgId, key))?.id).toBe(second.id);

      // The same key in the same organization still collides on the composite
      // unique. Do this last: a rejected statement aborts the transaction.
      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId: area.id, unitId },
          { idempotencyKey: key },
        ),
      );
      expect(cause.message).toMatch(/stock_movement_org_idempotency_key_key/);
    });
  });

  it("finds the reversal of a movement", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const original = await createTestStockMovement(tx, orgId, {
        itemId,
        locationId,
        storageAreaId: area.id,
        unitId,
      });
      const reversal = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        {
          movementType: "correction",
          quantityDelta: "-1",
          sourceType: "correction",
          reversalOfId: original.id,
        },
      );
      expect((await findStockMovementReversal(tx, original.id))?.id).toBe(reversal.id);
      expect(await findStockMovementReversal(tx, reversal.id)).toBeUndefined();
    });
  });

  it("lists movements in ledger order and honours the as-of bound", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { itemId, locationId, storageAreaId: area.id, unitId };
      const january = await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-01-01T00:00:00.000Z"),
      });
      const february = await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-02-01T00:00:00.000Z"),
      });
      const june = await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-06-01T00:00:00.000Z"),
      });

      const all = await listStockMovements(tx, { organizationId: orgId, itemId });
      expect(all.map((row) => row.id)).toEqual([january.id, february.id, june.id]);

      const asOfMarch = await listStockMovements(tx, {
        organizationId: orgId,
        itemId,
        asOf: at("2026-03-01T00:00:00.000Z"),
      });
      expect(asOfMarch.map((row) => row.id)).toEqual([january.id, february.id]);
    });
  });

  it("filters movements by a null lot and by a specific lot", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const lot = await createTestStockLot(tx, orgId, itemId, locationId);
      const refs = { itemId, locationId, storageAreaId: area.id, unitId };
      const untracked = await createTestStockMovement(tx, orgId, refs);
      const tracked = await createTestStockMovement(tx, orgId, refs, { lotId: lot.id });

      const nullLots = await listStockMovements(tx, {
        organizationId: orgId,
        itemId,
        lotId: null,
      });
      expect(nullLots.map((row) => row.id)).toEqual([untracked.id]);

      const thisLot = await listStockMovements(tx, {
        organizationId: orgId,
        itemId,
        lotId: lot.id,
      });
      expect(thisLot.map((row) => row.id)).toEqual([tracked.id]);

      // Absent filter returns both.
      expect(
        await listStockMovements(tx, { organizationId: orgId, itemId, locationId }),
      ).toHaveLength(2);
    });
  });

  it("filters movements by source type and id (DEC-116)", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { itemId, locationId, storageAreaId: area.id, unitId };
      // `adjustment`/`correction` are the guard's no-op source types, so the
      // filter is exercised without needing a real source row.
      const firstSourceId = randomUUID();
      const secondSourceId = randomUUID();
      const first = await createTestStockMovement(tx, orgId, refs, {
        sourceType: "adjustment",
        sourceId: firstSourceId,
      });
      const second = await createTestStockMovement(tx, orgId, refs, {
        sourceType: "adjustment",
        sourceId: secondSourceId,
      });
      const third = await createTestStockMovement(tx, orgId, refs, {
        sourceType: "correction",
        sourceId: firstSourceId,
      });

      const bySource = await listStockMovements(tx, {
        organizationId: orgId,
        sourceType: "adjustment",
        sourceId: firstSourceId,
      });
      expect(bySource.map((row) => row.id)).toEqual([first.id]);

      const byType = await listStockMovements(tx, {
        organizationId: orgId,
        sourceType: "adjustment",
      });
      expect(byType.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());

      const byId = await listStockMovements(tx, {
        organizationId: orgId,
        sourceId: firstSourceId,
      });
      expect(byId.map((row) => row.id).sort()).toEqual([first.id, third.id].sort());
    });
  });

  it("lists only un-reversed originals for a source with onlyReversible (DEC-116)", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { itemId, locationId, storageAreaId: area.id, unitId };
      // A real `sales_line` so the `sales_line` source guard accepts the
      // movements (unlike `adjustment`/`correction`, which are guard no-ops).
      const transactionRows = await tx
        .insert(salesTransaction)
        .values({
          organizationId: orgId,
          locationId,
          sourceSystem: "frontline",
          externalTransactionId: uniqueName("txn"),
          occurredAt: at("2026-03-01T00:00:00.000Z"),
          currency: "NOK",
        })
        .returning();
      const lineRows = await tx
        .insert(salesLine)
        .values({
          organizationId: orgId,
          salesTransactionId: transactionRows[0]!.id,
          quantity: "1",
        })
        .returning();
      const source = { sourceType: "sales_line", sourceId: lineRows[0]!.id };

      const unreversed = await createTestStockMovement(tx, orgId, refs, source);
      const reversedOriginal = await createTestStockMovement(tx, orgId, refs, source);
      // A movement that is itself a reversal: its `reversal_of_id` is set, so it
      // must be excluded even though it copies the original's source.
      await createTestStockMovement(tx, orgId, refs, {
        ...source,
        movementType: "correction",
        quantityDelta: "-1",
        reversalOfId: reversedOriginal.id,
      });

      const all = await listStockMovements(tx, {
        organizationId: orgId,
        sourceType: "sales_line",
        sourceId: lineRows[0]!.id,
      });
      expect(all).toHaveLength(3);

      const reversible = await listStockMovements(tx, {
        organizationId: orgId,
        sourceType: "sales_line",
        sourceId: lineRows[0]!.id,
        onlyReversible: true,
      });
      // The un-reversed original only: the reversed original is excluded (it has
      // a reversal) and its reversal is excluded (it is itself a reversal).
      expect(reversible.map((row) => row.id)).toEqual([unreversed.id]);
    });
  });

  it("sums movements per group at an as-of cutoff", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const lot = await createTestStockLot(tx, orgId, itemId, locationId);
      const refs = { itemId, locationId, storageAreaId: area.id, unitId };

      // Untracked (null-lot) group: two in-window movements and one the cutoff
      // must exclude.
      await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-01-01T00:00:00.000Z"),
        quantityDelta: "10",
        valueDelta: "100",
      });
      await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-02-01T00:00:00.000Z"),
        quantityDelta: "5",
        valueDelta: "50",
      });
      await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-06-01T00:00:00.000Z"),
        quantityDelta: "7",
        valueDelta: "70",
      });

      // Tracked-lot group: one in-window movement.
      await createTestStockMovement(tx, orgId, refs, {
        occurredAt: at("2026-01-15T00:00:00.000Z"),
        quantityDelta: "2",
        valueDelta: "20",
        lotId: lot.id,
      });

      const sums = await sumStockMovementsAsOf(tx, {
        organizationId: orgId,
        itemId,
        locationId,
        asOf: at("2026-03-01T00:00:00.000Z"),
      });

      const byLot = new Map(sums.map((row) => [row.lotId, row]));
      expect(byLot.size).toBe(2);

      const noLot = byLot.get(null);
      expect(noLot).toBeDefined();
      expect(noLot).toMatchObject({
        organizationId: orgId,
        itemId,
        locationId,
        storageAreaId: area.id,
        quantityOnHand: "15.000000",
        valueOnHand: "150.0000",
      });

      const tracked = byLot.get(lot.id);
      expect(tracked).toBeDefined();
      expect(tracked).toMatchObject({
        organizationId: orgId,
        itemId,
        locationId,
        storageAreaId: area.id,
        quantityOnHand: "2.000000",
        valueOnHand: "20.0000",
      });
    });
  });

  it("creates a storage area and finds it by id and code", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("area");
      const created = await createStorageArea(tx, {
        organizationId: orgId,
        locationId,
        code,
        name: "Walk-in",
        kind: "refrigerator",
      });

      expect((await findStorageArea(tx, created.id))?.code).toBe(code);
      expect(
        (await findStorageAreaByCode(tx, { organizationId: orgId, locationId, code }))?.id,
      ).toBe(created.id);
      expect(
        await findStorageAreaByCode(tx, {
          organizationId: orgId,
          locationId,
          code: uniqueName("missing"),
        }),
      ).toBeUndefined();
    });
  });

  it("creates or finds a lot by its natural key without racing", async () => {
    await inRollback(client.db, async (tx) => {
      const lotNumber = uniqueName("LOT");
      const input = {
        organizationId: orgId,
        itemId,
        locationId,
        lotNumber,
        expiryDate: "2026-06-30",
      };

      const first = await findOrCreateStockLot(tx, input);
      expect((await findStockLot(tx, first.id))?.lotNumber).toBe(lotNumber);

      const second = await findOrCreateStockLot(tx, input);
      expect(second.id).toBe(first.id);
      expect(second.expiryDate).toBe("2026-06-30");

      const rows = await tx.select().from(stockLot).where(eq(stockLot.lotNumber, lotNumber));
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects saving a balance row that was never locked", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      await expect(
        saveStockBalance(
          tx,
          {
            organizationId: orgId,
            itemId,
            locationId,
            storageAreaId: area.id,
            lotId: null,
          },
          {
            quantityOnHand: "1",
            valueOnHand: "1",
            avgUnitCost: "1",
            asOf: at("2026-03-05T00:00:00.000Z"),
          },
        ),
      ).rejects.toThrow(/lockStockBalance/);
    });
  });

  it("finds the organization and location by id", async () => {
    await inRollback(client.db, async (tx) => {
      expect((await findOrganizationById(tx, orgId))?.id).toBe(orgId);
      expect((await findLocationById(tx, locationId))?.id).toBe(locationId);
      expect(await findLocationById(tx, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });
  });

  it("installs the 0017 stock_lot FK and the source guard trigger", async () => {
    const constraints = await client.pool.query<{ conname: string }>(
      "select conname from pg_constraint where conname = $1",
      ["stock_lot_source_movement_id_stock_movement_id_fk"],
    );
    expect(constraints.rows).toHaveLength(1);
    const triggers = await client.pool.query<{ tgname: string }>(
      "select tgname from pg_trigger where tgname = $1 and not tgisinternal",
      ["stock_movement_source_guard"],
    );
    expect(triggers.rows).toHaveLength(1);
  });

  it("validates a goods_receipt source and accepts the modelled source type", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const receiptRows = await tx
        .insert(goodsReceipt)
        .values({
          organizationId: orgId,
          storeName: "Test Store",
          locationId,
          receivedAt: at("2026-02-01T00:00:00.000Z"),
          status: "submitted",
        })
        .returning();
      const receipt = receiptRows[0]!;

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        {
          movementType: "receipt",
          sourceType: "goods_receipt",
          sourceId: receipt.id,
        },
      );
      expect(posted.sourceId).toBe(receipt.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId: area.id, unitId },
          {
            movementType: "receipt",
            sourceType: "goods_receipt",
            sourceId: "00000000-0000-0000-0000-000000000000",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("uses the expected schema objects", () => {
    // Guard against a silent rename that would leave this file testing nothing.
    expect(goodsReceipt).toBeDefined();
    expect(stockBalance).toBeDefined();
    expect(stockLot).toBeDefined();
    expect(stockMovement).toBeDefined();
    expect(storageArea).toBeDefined();
  });
});
