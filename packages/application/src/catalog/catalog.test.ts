import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerSupplierItem } from "./register-supplier-item";
import { resolveConversion } from "./resolve-conversion";
import { FakeMasterDataStore } from "./test-support";
import type { ConversionEdge } from "./types";

const ORG = "org-1";
const AT = new Date("2026-09-19T00:00:00.000Z");

function buildStore(): FakeMasterDataStore {
  const store = new FakeMasterDataStore();
  store.units.set("g", { id: "g", code: "g", dimension: "mass", isBase: true });
  store.units.set("kg", { id: "kg", code: "kg", dimension: "mass", isBase: false });
  store.units.set("pack", { id: "pack", code: "pack", dimension: "package", isBase: true });
  store.items.set("item-1", { id: "item-1", organizationId: ORG, baseUnitId: "g" });
  store.suppliers.set("sup-1", { id: "sup-1", organizationId: ORG });
  return store;
}

function edgeOf(
  from: "g" | "kg" | "pack",
  to: "g" | "kg" | "pack",
  factor: string,
  overrides: Partial<ConversionEdge> = {},
): ConversionEdge {
  const unit = (id: string) => ({
    id,
    code: id,
    dimension:
      id === "kg" ? ("mass" as const) : id === "pack" ? ("package" as const) : ("mass" as const),
    isBase: id === "g" || id === "pack",
  });
  return {
    fromUnit: unit(from),
    toUnit: unit(to),
    factor,
    itemId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    ...overrides,
  };
}

describe("registerSupplierItem", () => {
  it("registers a pack conversion and returns the new supplier item id", async () => {
    const store = buildStore();
    const result = await registerSupplierItem(store, {
      organizationId: ORG,
      supplierId: "sup-1",
      itemId: "item-1",
      supplierSku: "FLOUR-25KG",
      packUnitId: "pack",
      packToBaseUnitFactor: "1000",
      minOrderQty: "1",
      leadTimeDays: 3,
      preferred: true,
    });
    expect(result.supplierItemId).toBe("supplier-item-1");
    expect(store.supplierItems[0]).toMatchObject({
      supplierSku: "FLOUR-25KG",
      packToBaseUnitFactor: "1000",
      minOrderQty: "1",
      leadTimeDays: 3,
      preferred: true,
    });
  });

  it("rejects an item or supplier outside the organization", async () => {
    const store = buildStore();
    store.items.set("item-2", { id: "item-2", organizationId: "other", baseUnitId: "g" });
    await expect(
      registerSupplierItem(store, {
        organizationId: ORG,
        supplierId: "sup-1",
        itemId: "item-2",
        supplierSku: "X",
        packUnitId: "pack",
        packToBaseUnitFactor: "1",
      }),
    ).rejects.toThrow("item not found in organization");

    await expect(
      registerSupplierItem(store, {
        organizationId: ORG,
        supplierId: "missing",
        itemId: "item-1",
        supplierSku: "X",
        packUnitId: "pack",
        packToBaseUnitFactor: "1",
      }),
    ).rejects.toThrow("supplier not found in organization");
  });

  it("rejects a missing pack unit", async () => {
    const store = buildStore();
    await expect(
      registerSupplierItem(store, {
        organizationId: ORG,
        supplierId: "sup-1",
        itemId: "item-1",
        supplierSku: "X",
        packUnitId: "missing",
        packToBaseUnitFactor: "1",
      }),
    ).rejects.toThrow("pack unit not found");
  });

  it("rejects an incompatible pack conversion (package to a non-base unit)", async () => {
    const store = buildStore();
    await expect(
      registerSupplierItem(store, {
        organizationId: ORG,
        supplierId: "sup-1",
        itemId: "item-1",
        supplierSku: "X",
        packUnitId: "pack",
        packToBaseUnitFactor: "1",
      }),
    ).resolves.toBeDefined();

    // Base unit is kg (not `is_base`), so `pack -> kg` is not a valid pack.
    store.items.set("item-kg", { id: "item-kg", organizationId: ORG, baseUnitId: "kg" });
    await expect(
      registerSupplierItem(store, {
        organizationId: ORG,
        supplierId: "sup-1",
        itemId: "item-kg",
        supplierSku: "Y",
        packUnitId: "pack",
        packToBaseUnitFactor: "1",
      }),
    ).rejects.toThrow(/incompatible pack dimensions/);
  });

  it("rejects a duplicate supplier SKU and an empty supplier SKU", async () => {
    const store = buildStore();
    const input = {
      organizationId: ORG,
      supplierId: "sup-1",
      itemId: "item-1",
      supplierSku: "DUP",
      packUnitId: "pack",
      packToBaseUnitFactor: "1",
    };
    await registerSupplierItem(store, input);
    await expect(registerSupplierItem(store, input)).rejects.toThrow(
      "supplier SKU already registered for this supplier",
    );
    await expect(registerSupplierItem(store, { ...input, supplierSku: "  " })).rejects.toThrow(
      "supplier SKU must not be empty",
    );
  });
});

describe("resolveConversion", () => {
  it("resolves an effective direct conversion", async () => {
    const store = buildStore();
    store.addConversion(edgeOf("kg", "g", "1000"));
    expect(
      await resolveConversion(store, {
        organizationId: ORG,
        fromUnitId: "kg",
        toUnitId: "g",
        asOf: AT,
      }),
    ).toEqual({ fromUnitId: "kg", toUnitId: "g", factor: "1000.000000" });
  });

  it("rejects an ambiguous item-scoped vs global conversion", async () => {
    const store = buildStore();
    store.addConversion(edgeOf("kg", "g", "1000"));
    store.addConversion(edgeOf("kg", "g", "900", { itemId: "item-1" }));
    await expect(
      resolveConversion(store, {
        organizationId: ORG,
        fromUnitId: "kg",
        toUnitId: "g",
        asOf: AT,
        itemId: "item-1",
      }),
    ).rejects.toThrow(/ambiguous conversion/);
  });

  it("rejects a conversion with no effective path", async () => {
    const store = buildStore();
    await expect(
      resolveConversion(store, {
        organizationId: ORG,
        fromUnitId: "kg",
        toUnitId: "g",
        asOf: AT,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects an unknown unit", async () => {
    const store = buildStore();
    await expect(
      resolveConversion(store, {
        organizationId: ORG,
        fromUnitId: "kg",
        toUnitId: "missing",
        asOf: AT,
      }),
    ).rejects.toThrow("conversion unit not found");
  });
});
