import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { costCenter, item, organization, supplier, supplierItem, unitConversion } from "../schema";
import {
  createCostCenter,
  createItem,
  createSupplier,
  createSupplierItem,
  createUnitConversion,
  findCostCenterByCode,
  findItemById,
  findSupplierByCode,
  findSupplierById,
  findSupplierItemBySku,
  listEffectiveConversions,
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

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("master data repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the organization persists.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates and finds a supplier by id and code within its organization", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("supplier");
      const created = await createSupplier(tx, {
        organizationId: orgId,
        code,
        name: "Test Supplier",
      });
      expect(created.currency).toBe("NOK");
      expect(created.active).toBe(true);
      expect((await findSupplierById(tx, created.id))?.code).toBe(code);
      expect((await findSupplierByCode(tx, orgId, code))?.id).toBe(created.id);
      expect(await findSupplierByCode(tx, orgId, "missing")).toBeUndefined();
    });
  });

  it("creates an item and finds it by id", async () => {
    await inRollback(client.db, async (tx) => {
      const baseUnit = await createTestUnit(tx, orgId);
      const created = await createItem(tx, {
        organizationId: orgId,
        code: uniqueName("item"),
        sku: uniqueName("sku"),
        name: "Flour",
        itemType: "ingredient",
        baseUnitId: baseUnit.id,
      });
      expect((await findItemById(tx, created.id))?.sku).toBe(created.sku);
    });
  });

  it("registers a supplier item with its pack conversion and finds it by supplier SKU", async () => {
    await inRollback(client.db, async (tx) => {
      const baseUnit = await createTestUnit(tx, orgId, {
        code: uniqueName("g"),
        dimension: "mass",
      });
      const packUnit = await createTestUnit(tx, orgId, {
        code: uniqueName("pack"),
        dimension: "package",
        isBase: false,
      });
      const testItem = await createTestItem(tx, orgId, baseUnit.id);
      const testSupplier = await createSupplier(tx, {
        organizationId: orgId,
        code: uniqueName("sup"),
        name: "Supplier",
      });

      const supplierSku = uniqueName("ssku");
      const created = await createSupplierItem(tx, {
        organizationId: orgId,
        supplierId: testSupplier.id,
        itemId: testItem.id,
        supplierSku,
        packUnitId: packUnit.id,
        packToBaseUnitFactor: "1000",
        minOrderQty: "1",
        leadTimeDays: 3,
      });
      expect(created.packToBaseUnitFactor).toBe("1000.000000");

      const found = await findSupplierItemBySku(tx, testSupplier.id, supplierSku);
      expect(found?.id).toBe(created.id);
      expect(await findSupplierItemBySku(tx, testSupplier.id, "missing")).toBeUndefined();
    });
  });

  it("rejects a non-positive pack factor at the database", async () => {
    await inRollback(client.db, async (tx) => {
      const baseUnit = await createTestUnit(tx, orgId);
      const testItem = await createTestItem(tx, orgId, baseUnit.id);
      const testSupplier = await createSupplier(tx, {
        organizationId: orgId,
        code: uniqueName("sup"),
        name: "Supplier",
      });
      await expect(
        createSupplierItem(tx, {
          organizationId: orgId,
          supplierId: testSupplier.id,
          itemId: testItem.id,
          supplierSku: uniqueName("ssku"),
          packUnitId: baseUnit.id,
          packToBaseUnitFactor: "0",
        }),
      ).rejects.toThrow();
    });
  });

  it("lists only the conversions effective at the as-of date, respecting item scope", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const kilo = await createTestUnit(tx, orgId, {
        code: uniqueName("kg"),
        dimension: "mass",
        isBase: false,
      });
      const testItem = await createTestItem(tx, orgId, gram.id);

      await createUnitConversion(tx, {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
        factor: "1000",
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        effectiveTo: at("2026-06-01T00:00:00.000Z"),
      });
      await createUnitConversion(tx, {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
        factor: "2000",
        effectiveFrom: at("2026-06-01T00:00:00.000Z"),
        effectiveTo: null,
      });
      await createUnitConversion(tx, {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
        factor: "1500",
        itemId: testItem.id,
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
      });

      const spring = await listEffectiveConversions(tx, {
        organizationId: orgId,
        asOf: at("2026-03-01T00:00:00.000Z"),
      });
      expect(spring).toHaveLength(1);
      expect(spring[0]?.factor).toBe("1000.000000");
      expect(spring[0]?.fromUnitCode).toBe(kilo.code);
      expect(spring[0]?.toUnitCode).toBe(gram.code);
      expect(spring[0]?.fromUnitDimension).toBe("mass");

      const summer = await listEffectiveConversions(tx, {
        organizationId: orgId,
        asOf: at("2026-07-01T00:00:00.000Z"),
      });
      expect(summer.map((row) => row.factor)).toEqual(["2000.000000"]);

      const withItem = await listEffectiveConversions(tx, {
        organizationId: orgId,
        asOf: at("2026-03-01T00:00:00.000Z"),
        itemId: testItem.id,
      });
      expect(withItem.map((row) => row.factor).sort()).toEqual(["1000.000000", "1500.000000"]);

      const otherItem = await listEffectiveConversions(tx, {
        organizationId: orgId,
        asOf: at("2026-03-01T00:00:00.000Z"),
        itemId: "00000000-0000-0000-0000-000000000000",
      });
      expect(otherItem.map((row) => row.factor)).toEqual(["1000.000000"]);
    });
  });

  it("creates a cost center and rejects an unknown kind", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("cc");
      const created = await createCostCenter(tx, {
        organizationId: orgId,
        code,
        name: "Kitchen",
        kind: "kitchen",
      });
      expect((await findCostCenterByCode(tx, orgId, code))?.id).toBe(created.id);
    });

    await inRollback(client.db, async (tx) => {
      await expect(
        createCostCenter(tx, {
          organizationId: orgId,
          code: uniqueName("cc"),
          name: "Bad",
          kind: "not_a_kind",
        }),
      ).rejects.toThrow();
    });
  });

  it("enforces the supplier SKU uniqueness within a supplier", async () => {
    await inRollback(client.db, async (tx) => {
      const baseUnit = await createTestUnit(tx, orgId);
      const testItem = await createTestItem(tx, orgId, baseUnit.id);
      const testSupplier = await createSupplier(tx, {
        organizationId: orgId,
        code: uniqueName("sup"),
        name: "Supplier",
      });
      const supplierSku = uniqueName("ssku");
      const base = {
        organizationId: orgId,
        supplierId: testSupplier.id,
        itemId: testItem.id,
        supplierSku,
        packUnitId: baseUnit.id,
        packToBaseUnitFactor: "1",
      };
      await createSupplierItem(tx, base);
      await expect(createSupplierItem(tx, base)).rejects.toThrow();
    });
  });

  it("installs the 0005 unit_conversion overlap and version constraints", async () => {
    const { rows } = await client.pool.query<{ conname: string }>(
      "select conname from pg_constraint where conname = any($1::text[])",
      [
        [
          "unit_conversion_global_no_overlap",
          "unit_conversion_item_no_overlap",
          "unit_conversion_version_key",
        ],
      ],
    );
    expect(rows.map((row) => row.conname).sort()).toEqual([
      "unit_conversion_global_no_overlap",
      "unit_conversion_item_no_overlap",
      "unit_conversion_version_key",
    ]);
  });

  it("rejects overlapping global unit_conversion windows", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const kilo = await createTestUnit(tx, orgId, {
        code: uniqueName("kg"),
        dimension: "mass",
        isBase: false,
      });
      const base = {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
      };
      await createUnitConversion(tx, {
        ...base,
        factor: "1000",
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        effectiveTo: at("2026-06-01T00:00:00.000Z"),
      });
      await expect(
        createUnitConversion(tx, {
          ...base,
          factor: "2000",
          effectiveFrom: at("2026-03-01T00:00:00.000Z"),
          effectiveTo: at("2026-09-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow(/unit_conversion_global_no_overlap/);
    });
  });

  it("rejects overlapping item-scoped unit_conversion windows", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const kilo = await createTestUnit(tx, orgId, {
        code: uniqueName("kg"),
        dimension: "mass",
        isBase: false,
      });
      const testItem = await createTestItem(tx, orgId, gram.id);
      const base = {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
        itemId: testItem.id,
      };
      await createUnitConversion(tx, {
        ...base,
        factor: "1000",
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
      });
      await expect(
        createUnitConversion(tx, {
          ...base,
          factor: "1500",
          effectiveFrom: at("2026-03-01T00:00:00.000Z"),
          effectiveTo: null,
        }),
      ).rejects.toThrow(/unit_conversion_item_no_overlap/);
    });
  });

  it("rejects a duplicate unit_conversion version tuple", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await createTestUnit(tx, orgId, { code: uniqueName("g"), dimension: "mass" });
      const kilo = await createTestUnit(tx, orgId, {
        code: uniqueName("kg"),
        dimension: "mass",
        isBase: false,
      });
      const base = {
        organizationId: orgId,
        fromUnitId: kilo.id,
        toUnitId: gram.id,
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        effectiveTo: at("2026-06-01T00:00:00.000Z"),
      };
      await createUnitConversion(tx, { ...base, factor: "1000" });
      // An exact duplicate version tuple is rejected by the overlap and/or the
      // unique key (the exclusion constraint fires first for an identical window).
      await expect(createUnitConversion(tx, { ...base, factor: "1000" })).rejects.toThrow(
        /unit_conversion_(global_no_overlap|version_key)/,
      );
    });
  });

  it("uses the expected schema objects", () => {
    // Guard against a silent rename that would leave this file testing nothing.
    expect(item).toBeDefined();
    expect(supplier).toBeDefined();
    expect(supplierItem).toBeDefined();
    expect(unitConversion).toBeDefined();
    expect(costCenter).toBeDefined();
  });
});
