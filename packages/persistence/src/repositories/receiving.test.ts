import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization } from "../schema";
import { createSupplier, createSupplierItem } from "./master-data";
import {
  createGoodsReceipt,
  createGoodsReceiptLine,
  findGoodsReceiptSummaryById,
  listGoodsReceiptSummaries,
  listReceivingSupplierItemOptions,
} from "./receiving";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestUnit,
  inRollback,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The minimal columns a receipt line needs; the landed cost is not read here. */
function lineInput(receiptId: string, itemId: string, unitId: string, price: string) {
  return {
    goodsReceiptId: receiptId,
    supplierItemId: null,
    itemId,
    receivedPackQty: "2",
    acceptedPackQty: "2",
    rejectedPackQty: "0",
    unitId,
    packToBaseFactor: "1000",
    price,
    discount: "0",
    taxBasis: "exclusive",
    taxCodeId: null,
    allocatedFreight: "0",
    importFee: "0",
    lotNumber: null,
    expiryDate: null,
    baseQtyAccepted: "2000.000000",
    landedBaseUnitCost: "0.0500",
  };
}

describe.skipIf(!databaseUrl)("receiving read model", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every test rolls back, so only the organization persists.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("lists receipts newest first with a derived gross total, filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const locationA = await createTestLocation(tx, orgId);
      const locationB = await createTestLocation(tx, orgId);
      const baseUnit = await createTestUnit(tx, orgId);
      const item = await createTestItem(tx, orgId, baseUnit.id, {
        code: uniqueName("item"),
        sku: uniqueName("sku"),
      });

      const older = await createGoodsReceipt(tx, {
        organizationId: orgId,
        supplierId: null,
        storeName: "Store A",
        locationId: locationA.id,
        receivedAt: new Date("2026-09-01T10:00:00.000Z"),
        status: "accepted",
        acceptedBy: randomUUID(),
        acceptedAt: new Date("2026-09-01T10:00:00.000Z"),
      });
      const newer = await createGoodsReceipt(tx, {
        organizationId: orgId,
        supplierId: null,
        storeName: "Store B",
        locationId: locationB.id,
        receivedAt: new Date("2026-09-09T10:00:00.000Z"),
        status: "accepted",
        acceptedBy: randomUUID(),
        acceptedAt: new Date("2026-09-09T10:00:00.000Z"),
      });
      await createGoodsReceiptLine(tx, lineInput(older.id, item.id, baseUnit.id, "10"));
      await createGoodsReceiptLine(tx, lineInput(older.id, item.id, baseUnit.id, "5"));
      await createGoodsReceiptLine(tx, lineInput(newer.id, item.id, baseUnit.id, "7.5"));

      const all = await listGoodsReceiptSummaries(tx, {
        organizationId: orgId,
        limit: 50,
        offset: 0,
      });
      expect(all.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(all[0]!.grossTotal).toBe("15.0000");
      expect(all[1]!.grossTotal).toBe("30.0000");

      const byLocation = await listGoodsReceiptSummaries(tx, {
        organizationId: orgId,
        locationId: locationA.id,
        limit: 50,
        offset: 0,
      });
      expect(byLocation.map((row) => row.id)).toEqual([older.id]);

      const page = await listGoodsReceiptSummaries(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(page.map((row) => row.id)).toEqual([older.id]);

      const detail = await findGoodsReceiptSummaryById(tx, newer.id);
      expect(detail).toMatchObject({ id: newer.id, grossTotal: "15.0000" });
      expect(await findGoodsReceiptSummaryById(tx, randomUUID())).toBeUndefined();
    });
  });

  it("returns receivable pack options joined to the item and pack unit", async () => {
    await inRollback(client.db, async (tx) => {
      const baseUnit = await createTestUnit(tx, orgId);
      const packUnit = await createTestUnit(tx, orgId, {
        code: uniqueName("pack"),
        dimension: "package",
        isBase: false,
      });
      const item = await createTestItem(tx, orgId, baseUnit.id, {
        code: uniqueName("item"),
        sku: uniqueName("sku"),
      });
      const supplier = await createSupplier(tx, {
        organizationId: orgId,
        code: uniqueName("sup"),
        name: "Test Supplier",
      });
      const supplierItem = await createSupplierItem(tx, {
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: item.id,
        supplierSku: uniqueName("ssku"),
        packUnitId: packUnit.id,
        packToBaseUnitFactor: "1000",
      });

      const options = await listReceivingSupplierItemOptions(tx, orgId);
      const option = options.find((row) => row.id === supplierItem.id);

      expect(option).toMatchObject({
        id: supplierItem.id,
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        baseUnitId: baseUnit.id,
        packUnitId: packUnit.id,
        packUnitCode: packUnit.code,
        packToBaseUnitFactor: "1000.000000",
      });
    });
  });
});
