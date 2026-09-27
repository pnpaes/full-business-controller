import {
  createDb,
  createSupplier,
  createSupplierItem,
  channel,
  findGoodsReceiptById,
  item,
  listAuditEventsForEntity,
  listCostObservationsForItem,
  listGoodsReceiptLines,
  listGoodsReceiptsForOrganization,
  listStockMovements,
  listSupplierPricesForSupplierItem,
  location,
  storageArea,
  stockLot,
  taxRule,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
  unit,
} from "@aquarela/persistence";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresInventoryStore, postStockMovement } from "../inventory";

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
  readonly storageAreaId: string;
  readonly otherStorageAreaId: string;
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
  // The location is created with a default storage area (`DEC-145`), so a
  // receipt with no explicit override posts into it.
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Test Location" })
    .returning();
  const area = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: createdLocation[0]!.id,
      code: `DRY_${suffix}`,
      name: "Dry store",
      kind: "dry_store",
    })
    .returning();
  const otherArea = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: createdLocation[0]!.id,
      code: `CHILL_${suffix}`,
      name: "Chiller",
      kind: "refrigerator",
    })
    .returning();
  await tx
    .update(location)
    .set({ defaultStorageAreaId: area[0]!.id })
    .where(eq(location.id, createdLocation[0]!.id));
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
    storageAreaId: area[0]!.id,
    otherStorageAreaId: otherArea[0]!.id,
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

  it("resolves an inclusive line's recoverable tax from a fixed linked rule", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const rule = await tx
        .insert(taxRule)
        .values({
          organizationId: orgId,
          code: `vat_fixed_${suffix}`,
          name: "Fixed 25",
          ratePct: "0.250000",
          taxBasis: "inclusive",
          taxTreatment: "fixed",
          recoverable: true,
          appliesTo: "cost",
          scopeType: "company_wide",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        })
        .returning();

      const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: fixture.supplierId,
        lines: [
          {
            supplierItemId: fixture.supplierItemId,
            itemId: fixture.itemId,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: fixture.packUnitId,
            packToBaseFactor: "1000",
            price: "125",
            taxBasis: "inclusive",
            taxCodeId: rule[0]!.id,
          },
        ],
      });

      // 125 inclusive at 25 % -> 25 recoverable -> 100 net -> 0.1000 per base unit.
      expect(result.lines[0]!.netPackPrice).toBe("100.0000");
      expect(result.lines[0]!.landedBaseUnitCost).toBe("0.1000");
      const lines = await listGoodsReceiptLines(tx, result.goodsReceiptId);
      expect(lines[0]!.taxCodeId).toBe(rule[0]!.id);
      expect(lines[0]!.landedBaseUnitCost).toBe("0.1000");
      // `DEC-075` (migration 0068): the resolved rate travels with the row.
      expect(lines[0]!.appliedTaxRate).toBe("0.250000");
      const prices = await listSupplierPricesForSupplierItem(tx, fixture.supplierItemId);
      expect(prices[0]).toMatchObject({ netPackPrice: "100.0000", landedBaseUnitCost: "0.1000" });
    });
  });

  it("resolves a channel-scoped override for an inclusive line", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const channelRow = await tx
        .insert(channel)
        .values({ organizationId: orgId, code: `chan_${suffix}`, name: "Takeaway" })
        .returning();
      const defaults = await tx
        .insert(taxRule)
        .values({
          organizationId: orgId,
          code: `vat_default_${suffix}`,
          name: "Default 25",
          ratePct: "0.250000",
          taxBasis: "inclusive",
          taxTreatment: "channel_overridable",
          recoverable: true,
          appliesTo: "cost",
          scopeType: "company_wide",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        })
        .returning();
      await tx.insert(taxRule).values({
        organizationId: orgId,
        code: `vat_takeaway_${suffix}`,
        name: "Takeaway 15",
        ratePct: "0.150000",
        taxBasis: "inclusive",
        taxTreatment: "channel_overridable",
        recoverable: true,
        appliesTo: "cost",
        scopeType: "channel",
        channelId: channelRow[0]!.id,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      });

      const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: fixture.supplierId,
        lines: [
          {
            supplierItemId: fixture.supplierItemId,
            itemId: fixture.itemId,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: fixture.packUnitId,
            packToBaseFactor: "1000",
            price: "115",
            taxBasis: "inclusive",
            taxCodeId: defaults[0]!.id,
            channelId: channelRow[0]!.id,
          },
        ],
      });

      // 115 inclusive at the 15 % channel override -> 15 recoverable -> 100 net.
      expect(result.lines[0]!.netPackPrice).toBe("100.0000");
      const lines = await listGoodsReceiptLines(tx, result.goodsReceiptId);
      expect(lines[0]!.appliedTaxRate).toBe("0.150000");
    });
  });

  it("refuses an explicit recoverable tax alongside a linked rule", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const rule = await tx
        .insert(taxRule)
        .values({
          organizationId: orgId,
          code: `vat_fixed2_${suffix}`,
          name: "Fixed 25",
          ratePct: "0.250000",
          taxBasis: "inclusive",
          taxTreatment: "fixed",
          recoverable: true,
          appliesTo: "cost",
          scopeType: "company_wide",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        })
        .returning();

      await expect(
        recordGoodsReceipt(createPostgresReceivingStore(tx), {
          organizationId: orgId,
          locationId: fixture.locationId,
          actorId: randomUUID(),
          receivedAt,
          supplierId: fixture.supplierId,
          lines: [
            {
              supplierItemId: fixture.supplierItemId,
              itemId: fixture.itemId,
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: fixture.packUnitId,
              packToBaseFactor: "1000",
              price: "125",
              taxBasis: "inclusive",
              taxCodeId: rule[0]!.id,
              recoverableTax: "25",
            },
          ],
        }),
      ).rejects.toThrow(/must not be supplied alongside a linked tax rule/);
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

  it("stores null applied_tax_rate where no rate applied (explicit amount and exclusive basis)", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await createFixture(tx, orgId);
      const store = createPostgresReceivingStore(tx);
      const base = {
        organizationId: orgId,
        locationId: fixture.locationId,
        actorId: randomUUID(),
        receivedAt,
        supplierId: null,
        storeName: "Rema 1000",
      };

      const explicit = await recordGoodsReceipt(store, {
        ...base,
        lines: [
          {
            itemId: fixture.itemId,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: fixture.packUnitId,
            packToBaseFactor: "1000",
            price: "125",
            taxBasis: "inclusive",
            recoverableTax: "25",
          },
        ],
      });
      const exclusive = await recordGoodsReceipt(store, {
        ...base,
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

      // An explicit amount is not a rate, and an exclusive price carries no tax:
      // null is the honest value, and the §5 cost is unchanged (regression guard).
      const explicitLines = await listGoodsReceiptLines(tx, explicit.goodsReceiptId);
      expect(explicitLines[0]!.appliedTaxRate).toBeNull();
      expect(explicitLines[0]!.landedBaseUnitCost).toBe("0.1000");

      const exclusiveLines = await listGoodsReceiptLines(tx, exclusive.goodsReceiptId);
      expect(exclusiveLines[0]!.appliedTaxRate).toBeNull();
      expect(exclusiveLines[0]!.landedBaseUnitCost).toBe("0.1000");
    });
  });

  describe("stock-ledger posting and storage-area resolution (DEC-145)", () => {
    const exclusiveLine = (fixture: Fixture) => ({
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
    });

    it("posts one receipt movement per line with the resolved area, quantity, cost and lot", async () => {
      await inRollback(client.db, async (tx) => {
        const fixture = await createFixture(tx, orgId);
        const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
          organizationId: orgId,
          locationId: fixture.locationId,
          actorId: randomUUID(),
          receivedAt,
          supplierId: fixture.supplierId,
          lines: [{ ...exclusiveLine(fixture), lotNumber: "LOT-1", expiryDate: "2026-12-31" }],
        });

        const movements = await listStockMovements(tx, {
          organizationId: orgId,
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
        });
        expect(movements).toHaveLength(1);
        const movement = movements[0]!;
        // The receipt carried no override, so the location default resolves.
        expect(movement).toMatchObject({
          organizationId: orgId,
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          movementType: "receipt",
          quantityDelta: "2000.000000",
          unitCost: "0.0500",
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
          idempotencyKey: `receipt-${result.goodsReceiptId}-${result.lines[0]!.goodsReceiptLineId}`,
        });
        expect(movement.lotId).not.toBeNull();
        const lots = await tx.select().from(stockLot).where(eq(stockLot.id, movement.lotId!));
        expect(lots[0]).toMatchObject({ lotNumber: "LOT-1", expiryDate: "2026-12-31" });
      });
    });

    it("uses the explicit override over the location default", async () => {
      await inRollback(client.db, async (tx) => {
        const fixture = await createFixture(tx, orgId);
        const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
          organizationId: orgId,
          locationId: fixture.locationId,
          storageAreaId: fixture.otherStorageAreaId,
          actorId: randomUUID(),
          receivedAt,
          supplierId: fixture.supplierId,
          lines: [exclusiveLine(fixture)],
        });

        const movements = await listStockMovements(tx, {
          organizationId: orgId,
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
        });
        expect(movements).toHaveLength(1);
        expect(movements[0]).toMatchObject({ storageAreaId: fixture.otherStorageAreaId });
        // The override is persisted on the receipt row, not only on the movement.
        const receipt = await findGoodsReceiptById(tx, result.goodsReceiptId);
        expect(receipt).toMatchObject({ storageAreaId: fixture.otherStorageAreaId });
      });
    });

    it("fails closed (no movement, no receipt) when neither area resolves", async () => {
      await inRollback(client.db, async (tx) => {
        const fixture = await createFixture(tx, orgId);
        await tx
          .update(location)
          .set({ defaultStorageAreaId: null })
          .where(eq(location.id, fixture.locationId));

        await expect(
          recordGoodsReceipt(createPostgresReceivingStore(tx), {
            organizationId: orgId,
            locationId: fixture.locationId,
            actorId: randomUUID(),
            receivedAt,
            supplierId: fixture.supplierId,
            lines: [exclusiveLine(fixture)],
          }),
        ).rejects.toThrow(/no storage area to receive into/);

        const movements = await listStockMovements(tx, {
          organizationId: orgId,
          sourceType: "goods_receipt",
        });
        expect(movements).toHaveLength(0);
        expect(await listGoodsReceiptsForOrganization(tx, orgId)).toHaveLength(0);
      });
    });

    it("does not double-post when the same idempotency key is replayed", async () => {
      await inRollback(client.db, async (tx) => {
        const fixture = await createFixture(tx, orgId);
        const result = await recordGoodsReceipt(createPostgresReceivingStore(tx), {
          organizationId: orgId,
          locationId: fixture.locationId,
          actorId: randomUUID(),
          receivedAt,
          supplierId: fixture.supplierId,
          lines: [{ ...exclusiveLine(fixture), lotNumber: "LOT-2", expiryDate: "2026-11-30" }],
        });
        const [movement] = await listStockMovements(tx, {
          organizationId: orgId,
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
        });
        expect(movement).toBeDefined();

        const replay = await postStockMovement(createPostgresInventoryStore(tx), {
          organizationId: orgId,
          actorId: movement!.postedBy,
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          itemId: fixture.itemId,
          movementType: "receipt",
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
          quantityDelta: "2000.000000",
          unitCost: "0.0500",
          occurredAt: receivedAt.toISOString(),
          idempotencyKey: movement!.idempotencyKey!,
        });

        expect(replay.replayed).toBe(true);
        expect(replay.movementId).toBe(movement!.id);
        const after = await listStockMovements(tx, {
          organizationId: orgId,
          sourceType: "goods_receipt",
          sourceId: result.goodsReceiptId,
        });
        expect(after).toHaveLength(1);
      });
    });
  });
});
