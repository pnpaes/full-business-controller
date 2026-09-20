import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization } from "../schema";
import {
  createSupplier,
  createSupplierItem,
  createUnit,
  findItemByCode,
  findItemBySku,
  findItemWithUnitById,
  findUnitByCode,
  listItems,
  listSupplierItemsForItem,
} from "./master-data";
import {
  createTestItem,
  createTestOrganization,
  createTestUnit,
  inRollback,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("catalog read repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a unit and finds it by code within its organization", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("unit");
      const created = await createUnit(tx, {
        organizationId: orgId,
        code,
        dimension: "mass",
        isBase: true,
      });
      expect((await findUnitByCode(tx, orgId, code))?.id).toBe(created.id);
      expect(await findUnitByCode(tx, orgId, "missing")).toBeUndefined();
    });
  });

  it("lists organization items joined to the base unit, with search, type and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const base = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const flour = await createTestItem(tx, orgId, base.id, {
        code: uniqueName("A_flour"),
        sku: uniqueName("SKU_flour"),
        name: "Bread Flour",
        itemType: "ingredient",
      });
      await createTestItem(tx, orgId, base.id, {
        code: uniqueName("B_sugar"),
        sku: uniqueName("SKU_sugar"),
        name: "Caster Sugar",
        itemType: "ingredient",
      });
      await createTestItem(tx, orgId, base.id, {
        code: uniqueName("C_cups"),
        sku: uniqueName("SKU_cups"),
        name: "Paper Cups",
        itemType: "packaging",
      });

      const all = await listItems(tx, { organizationId: orgId, limit: 10, offset: 0 });
      expect(all.total).toBe(3);
      expect(all.rows).toHaveLength(3);
      // Ordered by code: A_ < B_ < C_ regardless of insertion order.
      expect(all.rows.map((row) => row.code)).toEqual([...all.rows.map((row) => row.code)].sort());
      const first = all.rows[0]!;
      expect(first.baseUnitCode).toBe(base.code);
      expect(first.baseUnitId).toBe(base.id);
      expect(first.currentCost).toBeNull();
      expect(first.lotTracked).toBe(false);
      expect(first.inventoryPolicy).toBe("stocked");
      expect(first.activeFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const byName = await listItems(tx, {
        organizationId: orgId,
        search: "Bread",
        limit: 10,
        offset: 0,
      });
      expect(byName.total).toBe(1);
      expect(byName.rows[0]?.id).toBe(flour.id);

      const bySku = await listItems(tx, {
        organizationId: orgId,
        search: flour.sku.slice(4),
        limit: 10,
        offset: 0,
      });
      expect(bySku.rows.map((row) => row.id)).toContain(flour.id);

      const packaging = await listItems(tx, {
        organizationId: orgId,
        itemType: "packaging",
        limit: 10,
        offset: 0,
      });
      expect(packaging.total).toBe(1);
      expect(packaging.rows[0]?.itemType).toBe("packaging");

      const secondPage = await listItems(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(secondPage.total).toBe(3);
      expect(secondPage.rows).toHaveLength(1);
      expect(secondPage.rows[0]?.code).toBe(all.rows[1]?.code);

      const unknownOrg = await listItems(tx, {
        organizationId: "00000000-0000-0000-0000-000000000000",
        limit: 10,
        offset: 0,
      });
      expect(unknownOrg.total).toBe(0);
    });
  });

  it("finds a single item with its base unit code by id and by natural key", async () => {
    await inRollback(client.db, async (tx) => {
      const base = await createTestUnit(tx, orgId, { code: uniqueName("kg"), dimension: "mass" });
      const created = await createTestItem(tx, orgId, base.id);
      const found = await findItemWithUnitById(tx, created.id);
      expect(found?.baseUnitCode).toBe(base.code);
      expect(found?.sku).toBe(created.sku);
      expect((await findItemByCode(tx, orgId, created.code))?.id).toBe(created.id);
      expect((await findItemBySku(tx, orgId, created.sku))?.id).toBe(created.id);
      expect(
        await findItemWithUnitById(tx, "00000000-0000-0000-0000-000000000000"),
      ).toBeUndefined();
    });
  });

  it("lists the supplier packs for one item with supplier and pack-unit codes", async () => {
    await inRollback(client.db, async (tx) => {
      const base = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const pack = await createTestUnit(tx, orgId, {
        code: uniqueName("pack"),
        dimension: "package",
        isBase: false,
      });
      const item = await createTestItem(tx, orgId, base.id);
      const supplier = await createSupplier(tx, {
        organizationId: orgId,
        code: uniqueName("sup"),
        name: "Demo Supplier",
      });
      await createSupplierItem(tx, {
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: item.id,
        supplierSku: uniqueName("ssku"),
        packUnitId: pack.id,
        packToBaseUnitFactor: "25000",
        leadTimeDays: 2,
        preferred: true,
      });

      const rows = await listSupplierItemsForItem(tx, orgId, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.supplierCode).toBe(supplier.code);
      expect(rows[0]?.supplierName).toBe("Demo Supplier");
      expect(rows[0]?.packUnitCode).toBe(pack.code);
      expect(rows[0]?.packToBaseUnitFactor).toBe("25000.000000");
      expect(rows[0]?.preferred).toBe(true);

      const none = await listSupplierItemsForItem(
        tx,
        orgId,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(none).toEqual([]);
    });
  });
});
