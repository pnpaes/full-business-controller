import {
  createDb,
  createSupplier,
  createSupplierItem,
  findGoodsReceiptById,
  item,
  listAuditEventsForEntity,
  listCostObservationsForItem,
  listGoodsReceiptLines,
  listGoodsReceiptsForOrganization,
  listSupplierPricesForSupplierItem,
  location,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
  unit,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresReceivingStore } from "./postgres-store";
import { recordGoodsReceipt, type RecordGoodsReceiptInput } from "./record-goods-receipt";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

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
  readonly itemId: string;
  readonly packUnitId: string;
  readonly supplierId: string;
  readonly supplierItemId: string;
}

async function createFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const base = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const pack = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `pack_${suffix}`, dimension: "package", isBase: false })
    .returning();
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Test Location" })
    .returning();
  const flour = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `flour_${suffix}`,
      sku: `FLOUR_${suffix}`,
      name: "Flour",
      itemType: "ingredient",
      baseUnitId: base[0]!.id,
    })
    .returning();
  const supplier = await createSupplier(tx, {
    organizationId: orgId,
    code: `sup_${suffix}`,
    name: "Supplier",
  });
  const supplierItem = await createSupplierItem(tx, {
    organizationId: orgId,
    supplierId: supplier.id,
    itemId: flour[0]!.id,
    supplierSku: `SSKU_${suffix}`,
    packUnitId: pack[0]!.id,
    packToBaseUnitFactor: "1000",
  });

  return {
    locationId: createdLocation[0]!.id,
    itemId: flour[0]!.id,
    packUnitId: pack[0]!.id,
    supplierId: supplier.id,
    supplierItemId: supplierItem.id,
  };
}

describe.skipIf(!databaseUrl)("recordGoodsReceipt against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Receiving IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  const receivedAt = new Date("2026-09-19T10:00:00.000Z");

  it("records an accepted receipt, the line and an effective-dated supplier_price in one transaction", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const input: RecordGoodsReceiptInput = {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: fixture.supplierId,
        lines: [
          {
            supplierItemId: fixture.supplierItemId,
            itemId: fixture.itemId,
            receivedPackQty: "2",
            acceptedPackQty: "2",
            unitId: fixture.packUnitId,
            packToBaseFactor: "1000",
            price: "100",
            discount: "5",
            taxBasis: "exclusive",
            allocatedFreight: "3",
            importFee: "2",
          },
        ],
      };

      const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), input);

      const receipt = await findGoodsReceiptById(tx, result.goodsReceiptId);
      expect(receipt).toMatchObject({ status: "accepted", supplierId: fixture.supplierId });

      const lines = await listGoodsReceiptLines(tx, result.goodsReceiptId);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        baseQtyAccepted: "2000.000000",
        landedBaseUnitCost: "0.0500",
        price: "100.0000",
      });

      const prices = await listSupplierPricesForSupplierItem(tx, fixture.supplierItemId);
      expect(prices).toHaveLength(1);
      expect(prices[0]).toMatchObject({
        grossPackPrice: "100.0000",
        netPackPrice: "95.0000",
        landedPackCost: "100.0000",
        landedBaseUnitCost: "0.0500",
        sourceReceiptId: result.goodsReceiptId,
        effectiveTo: null,
      });

      const audits = await listAuditEventsForEntity(tx, "goods_receipt", result.goodsReceiptId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "receiving.goods_receipt.recorded",
        entityType: "goods_receipt",
        after: { status: "accepted", lineCount: 1, gross_total: "200.0000" },
      });
    });
  });

  it("closes the previous supplier_price window before appending the next", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const store = createPostgresReceivingStore(tx);
      const line = {
        supplierItemId: fixture.supplierItemId,
        itemId: fixture.itemId,
        receivedPackQty: "1",
        acceptedPackQty: "1",
        unitId: fixture.packUnitId,
        packToBaseFactor: "1000",
        price: "100",
        taxBasis: "exclusive",
      };
      const base: RecordGoodsReceiptInput = {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: fixture.supplierId,
        lines: [line],
      };
      await recordGoodsReceipt(store, base);
      const later = new Date("2026-10-01T10:00:00.000Z");
      await recordGoodsReceipt(store, {
        ...base,
        receivedAt: later,
        lines: [{ ...line, price: "200" }],
      });

      const prices = await listSupplierPricesForSupplierItem(tx, fixture.supplierItemId);
      expect(prices).toHaveLength(2);
      const first = prices.find((row) => row.grossPackPrice === "100.0000");
      const second = prices.find((row) => row.grossPackPrice === "200.0000");
      expect(first?.effectiveTo).toEqual(later);
      expect(second?.effectiveTo).toBeNull();
    });
  });

  it("keeps half-open windows non-overlapping when a receipt shares a timestamp", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const store = createPostgresReceivingStore(tx);
      const line = {
        supplierItemId: fixture.supplierItemId,
        itemId: fixture.itemId,
        receivedPackQty: "1",
        acceptedPackQty: "1",
        unitId: fixture.packUnitId,
        packToBaseFactor: "1000",
        price: "100",
        taxBasis: "exclusive",
      };
      const base: RecordGoodsReceiptInput = {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: fixture.supplierId,
        lines: [line],
      };
      await recordGoodsReceipt(store, base);
      // Same instant, same supplier item: the previous window closes at
      // `receivedAt` as an empty `[receivedAt, receivedAt)` interval, so the two
      // windows are non-overlapping under half-open semantics and exactly one
      // stays open.
      await recordGoodsReceipt(store, { ...base, lines: [{ ...line, price: "200" }] });

      const prices = await listSupplierPricesForSupplierItem(tx, fixture.supplierItemId);
      expect(prices).toHaveLength(2);
      expect(prices.every((row) => row.effectiveFrom.getTime() === receivedAt.getTime())).toBe(
        true,
      );
      const open = prices.filter((row) => row.effectiveTo === null);
      expect(open).toHaveLength(1);
      expect(open[0]!.grossPackPrice).toBe("200.0000");
      const closed = prices.filter((row) => row.effectiveTo !== null);
      expect(closed).toHaveLength(1);
      expect(closed[0]!.effectiveTo!.getTime()).toBe(receivedAt.getTime());
    });
  });

  it("appends a cost_observation for an ad-hoc purchase with no supplier", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: null,
        storeName: "Rema 1000",
        lines: [
          {
            itemId: fixture.itemId,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: fixture.packUnitId,
            packToBaseFactor: "1000",
            price: "100",
            taxBasis: "exclusive",
          },
        ],
      });
      expect(result.lines[0]!.priceHistoryKind).toBe("cost_observation");

      const observations = await listCostObservationsForItem(tx, fixture.itemId);
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({
        storeName: "Rema 1000",
        observedAt: "2026-09-19",
        packSize: "1000.000000",
        source: "receipt",
      });
    });
  });

  it("rounds HALF_UP at B1 where the 5th decimal decides (2 / 3)", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: null,
        storeName: "Rema 1000",
        lines: [
          {
            itemId: fixture.itemId,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: fixture.packUnitId,
            packToBaseFactor: "3",
            price: "2",
            taxBasis: "exclusive",
          },
        ],
      });
      expect(result.lines[0]!.baseQtyAccepted).toBe("3.000000");
      expect(result.lines[0]!.landedBaseUnitCost).toBe("0.6667");
      const lines = await listGoodsReceiptLines(tx, result.goodsReceiptId);
      expect(lines[0]!.landedBaseUnitCost).toBe("0.6667");
    });
  });

  it("rejects base_units_received <= 0 and accepted > received", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const store = createPostgresReceivingStore(tx);
      const line = {
        itemId: fixture.itemId,
        receivedPackQty: "1",
        acceptedPackQty: "1",
        unitId: fixture.packUnitId,
        packToBaseFactor: "1000",
        price: "100",
        taxBasis: "exclusive",
      };
      const base: RecordGoodsReceiptInput = {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: null,
        storeName: "Rema 1000",
        lines: [line],
      };
      await expect(
        recordGoodsReceipt(store, { ...base, lines: [{ ...line, acceptedPackQty: "0" }] }),
      ).rejects.toThrow(/must be positive/);
      await expect(
        recordGoodsReceipt(store, {
          ...base,
          lines: [{ ...line, receivedPackQty: "1", acceptedPackQty: "2" }],
        }),
      ).rejects.toThrow(/must not exceed receivedPackQty/);

      const receipts = await listGoodsReceiptsForOrganization(tx, orgId);
      expect(receipts).toHaveLength(0);
    });
  });

  it("rejects an inclusive price with no recoverable tax", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      await expect(
        recordGoodsReceipt(createPostgresReceivingStore(tx), {
          organizationId: orgId,
          locationId: fixture.locationId,
          actorId: randomUUID(),
          receivedAt,
          supplierId: null,
          storeName: "Rema 1000",
          lines: [
            {
              itemId: fixture.itemId,
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: fixture.packUnitId,
              packToBaseFactor: "1000",
              price: "125",
              taxBasis: "inclusive",
            },
          ],
        }),
      ).rejects.toThrow(/recoverableTax is required/);
    });
  });
});
