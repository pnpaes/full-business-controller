import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerItem } from "./register-item";
import { registerUnit } from "./register-unit";
import { FakeMasterDataStore } from "./test-support";

const ORG = "org-1";

async function seedBaseUnit(store: FakeMasterDataStore): Promise<string> {
  const unit = await registerUnit(store, {
    organizationId: ORG,
    code: "g",
    dimension: "mass",
    isBase: true,
  });
  return unit.unitId;
}

describe("registerUnit", () => {
  it("creates a unit then returns the existing one on a re-run", async () => {
    const store = new FakeMasterDataStore();
    const first = await registerUnit(store, {
      organizationId: ORG,
      code: "kg",
      dimension: "mass",
    });
    expect(first.created).toBe(true);

    const second = await registerUnit(store, {
      organizationId: ORG,
      code: "kg",
      dimension: "mass",
    });
    expect(second.created).toBe(false);
    expect(second.unitId).toBe(first.unitId);
    expect(store.units.size).toBe(1);
  });

  it("rejects an empty code and an unknown dimension", async () => {
    const store = new FakeMasterDataStore();
    await expect(
      registerUnit(store, { organizationId: ORG, code: "  ", dimension: "mass" }),
    ).rejects.toThrow("unit code must not be empty");
    await expect(
      registerUnit(store, {
        organizationId: ORG,
        code: "x",
        dimension: "not_a_dimension" as never,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("registerItem", () => {
  it("creates an item then returns the existing one on a re-run by code", async () => {
    const store = new FakeMasterDataStore();
    const baseUnitId = await seedBaseUnit(store);
    const input = {
      organizationId: ORG,
      code: "BEANS",
      sku: "BEANS-1KG",
      name: "Espresso Beans",
      itemType: "ingredient",
      baseUnitId,
      lotTracked: true,
    };
    const first = await registerItem(store, input);
    expect(first.created).toBe(true);

    const second = await registerItem(store, input);
    expect(second.created).toBe(false);
    expect(second.itemId).toBe(first.itemId);
    expect(store.items.size).toBe(1);
  });

  it("rejects a duplicate SKU under a different code", async () => {
    const store = new FakeMasterDataStore();
    const baseUnitId = await seedBaseUnit(store);
    await registerItem(store, {
      organizationId: ORG,
      code: "BEANS",
      sku: "SHARED-SKU",
      name: "Espresso Beans",
      itemType: "ingredient",
      baseUnitId,
    });
    await expect(
      registerItem(store, {
        organizationId: ORG,
        code: "OTHER",
        sku: "SHARED-SKU",
        name: "Other",
        itemType: "ingredient",
        baseUnitId,
      }),
    ).rejects.toThrow("item SKU already registered in organization");
  });

  it("rejects a missing base unit and blank identity fields", async () => {
    const store = new FakeMasterDataStore();
    const base = {
      organizationId: ORG,
      code: "X",
      sku: "X-1",
      name: "X",
      itemType: "ingredient",
    };
    await expect(registerItem(store, { ...base, baseUnitId: "missing" })).rejects.toThrow(
      "base unit not found",
    );
    await expect(
      registerItem(store, { ...base, code: " ", baseUnitId: "missing" }),
    ).rejects.toThrow("item code must not be empty");
    await expect(registerItem(store, { ...base, sku: " ", baseUnitId: "missing" })).rejects.toThrow(
      "item SKU must not be empty",
    );
    await expect(
      registerItem(store, { ...base, name: " ", baseUnitId: "missing" }),
    ).rejects.toThrow("item name must not be empty");
  });
});
