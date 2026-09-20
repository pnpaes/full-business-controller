import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { getItem } from "./get-item";
import { listSupplierItems } from "./list-supplier-items";
import { FakeMasterDataStore } from "./test-support";
import type { CatalogItemRecord, ConversionEdge, SupplierItemDetail } from "./types";

const ORG = "org-1";
const AT = new Date("2026-09-19T00:00:00.000Z");

const ITEM: CatalogItemRecord = {
  id: "item-1",
  organizationId: ORG,
  code: "BEANS",
  sku: "BEANS-1KG",
  name: "Espresso Beans",
  itemType: "ingredient",
  baseUnitId: "g",
  baseUnitCode: "g",
  inventoryPolicy: "stocked",
  lotTracked: true,
  currentCost: "0.2500",
  activeFrom: "2026-01-01",
  activeTo: null,
};

const PACK: SupplierItemDetail = {
  id: "si-1",
  organizationId: ORG,
  supplierId: "sup-1",
  supplierCode: "SUP",
  supplierName: "Demo Supplier",
  itemId: "item-1",
  supplierSku: "BEANS-25KG",
  packUnitId: "pack",
  packUnitCode: "pack",
  packToBaseUnitFactor: "25000.000000",
  minOrderQty: "1.000000",
  leadTimeDays: 2,
  preferred: true,
};

const CONVERSION: ConversionEdge = {
  fromUnit: { id: "kg", code: "kg", dimension: "mass", isBase: false },
  toUnit: { id: "g", code: "g", dimension: "mass", isBase: true },
  factor: "1000.000000",
  itemId: "item-1",
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
};

function buildStore(): FakeMasterDataStore {
  const store = new FakeMasterDataStore();
  store.addCatalogItem(ITEM);
  store.supplierItemDetails.push(PACK);
  store.addConversion(CONVERSION);
  return store;
}

describe("getItem", () => {
  it("returns the item with its supplier packs and item-scoped conversions", async () => {
    const store = buildStore();
    const detail = await getItem(store, { organizationId: ORG, itemId: "item-1", asOf: AT });
    expect(detail.item).toEqual(ITEM);
    expect(detail.supplierItems).toEqual([PACK]);
    expect(detail.conversions).toEqual([CONVERSION]);
  });

  it("returns an empty pack/conversion list when the item has none", async () => {
    const store = buildStore();
    store.addCatalogItem({ ...ITEM, id: "item-2", code: "SUGAR" });
    const detail = await getItem(store, { organizationId: ORG, itemId: "item-2", asOf: AT });
    expect(detail.item.id).toBe("item-2");
    expect(detail.supplierItems).toEqual([]);
    expect(detail.conversions).toEqual([]);
  });

  it("rejects an unknown item and a cross-organization item", async () => {
    const store = buildStore();
    await expect(
      getItem(store, { organizationId: ORG, itemId: "missing", asOf: AT }),
    ).rejects.toThrow("item not found in organization");
    await expect(
      getItem(store, { organizationId: "org-2", itemId: "item-1", asOf: AT }),
    ).rejects.toThrow("item not found in organization");
  });
});

describe("listSupplierItems", () => {
  it("lists the packs for an item and is organization-scoped", async () => {
    const store = buildStore();
    await expect(
      listSupplierItems(store, { organizationId: ORG, itemId: "item-1" }),
    ).resolves.toEqual([PACK]);
    await expect(
      listSupplierItems(store, { organizationId: ORG, itemId: "missing" }),
    ).rejects.toThrow(DomainError);
    await expect(
      listSupplierItems(store, { organizationId: "org-2", itemId: "item-1" }),
    ).rejects.toThrow("item not found in organization");
  });
});
