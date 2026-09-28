import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerItem } from "./register-item";
import { registerUnit } from "./register-unit";
import { FakeMasterDataStore } from "./test-support";
import { updateItem } from "./update-item";

const ORG = "org-1";
const ACTOR = "user-1";

async function seedItem(store: FakeMasterDataStore): Promise<string> {
  const base = await registerUnit(store, {
    organizationId: ORG,
    code: "g",
    dimension: "mass",
    isBase: true,
  });
  const item = await registerItem(store, {
    organizationId: ORG,
    code: "FLOUR",
    sku: "FL-1",
    name: "Flour",
    itemType: "ingredient",
    baseUnitId: base.unitId,
  });
  return item.itemId;
}

describe("updateItem", () => {
  it("updates the mutable fields and records one audit fact", async () => {
    const store = new FakeMasterDataStore();
    const itemId = await seedItem(store);

    const result = await updateItem(store, {
      organizationId: ORG,
      actorId: ACTOR,
      itemId,
      name: "  Wheat flour T65  ",
      inventoryPolicy: "non_stock",
      lotTracked: true,
    });

    expect(result.itemId).toBe(itemId);
    expect(store.catalogItems.get(itemId)).toMatchObject({
      name: "Wheat flour T65",
      inventoryPolicy: "non_stock",
      lotTracked: true,
    });
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: ORG,
      actorId: ACTOR,
      action: "catalog.item.updated",
      entityType: "item",
      entityId: itemId,
    });
  });

  it("rejects an empty name", async () => {
    const store = new FakeMasterDataStore();
    const itemId = await seedItem(store);
    await expect(
      updateItem(store, { organizationId: ORG, actorId: ACTOR, itemId, name: "   " }),
    ).rejects.toThrow("item name must not be empty");
    expect(store.audits).toHaveLength(0);
  });

  it("updates purpose and rejects an unknown value (DEC-150)", async () => {
    const store = new FakeMasterDataStore();
    const itemId = await seedItem(store);
    await updateItem(store, {
      organizationId: ORG,
      actorId: ACTOR,
      itemId,
      purpose: "for_sale",
    });
    expect(store.catalogItems.get(itemId)?.purpose).toBe("for_sale");
    await expect(
      updateItem(store, { organizationId: ORG, actorId: ACTOR, itemId, purpose: "not_a_purpose" }),
    ).rejects.toThrow(/purpose must be one of/);
  });

  it("rejects an empty change set and an unknown inventory policy", async () => {
    const store = new FakeMasterDataStore();
    const itemId = await seedItem(store);
    await expect(
      updateItem(store, { organizationId: ORG, actorId: ACTOR, itemId }),
    ).rejects.toThrow("no item changes provided");
    await expect(
      updateItem(store, {
        organizationId: ORG,
        actorId: ACTOR,
        itemId,
        inventoryPolicy: "not_a_policy",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("treats an unknown or cross-organization id as a domain failure", async () => {
    const store = new FakeMasterDataStore();
    const itemId = await seedItem(store);
    await expect(
      updateItem(store, { organizationId: ORG, actorId: ACTOR, itemId: "missing", name: "x" }),
    ).rejects.toThrow("item not found in organization");
    await expect(
      updateItem(store, { organizationId: "org-2", actorId: ACTOR, itemId, name: "x" }),
    ).rejects.toThrow("item not found in organization");
    expect(store.audits).toHaveLength(0);
  });
});
