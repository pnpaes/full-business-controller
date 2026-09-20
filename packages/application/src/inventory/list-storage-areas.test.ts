import { describe, expect, it } from "vitest";

import { listStorageAreas } from "./list-storage-areas";
import { listLocations, listStockedItems } from "./list-inventory-options";
import { FakeInventoryStore, seedInventoryFixture } from "./test-support";

describe("listStorageAreas", () => {
  it("returns an organization's areas in code order and narrows by location", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    store.storageAreas.set("area-2", {
      id: "area-2",
      organizationId: "org",
      locationId: "loc-other",
      code: "AMB",
      name: "Ambient",
      kind: "other",
      isTransit: false,
    });
    store.storageAreas.set("area-3", {
      id: "area-3",
      organizationId: "org-other",
      locationId: "loc",
      code: "AAA",
      name: "Foreign",
      kind: "other",
      isTransit: false,
    });

    const all = await listStorageAreas(store, { organizationId: "org" });
    expect(all.map((area) => area.code)).toEqual(["AMB", "DRY"]);

    const onlyOther = await listStorageAreas(store, {
      organizationId: "org",
      locationId: "loc-other",
    });
    expect(onlyOther.map((area) => area.code)).toEqual(["AMB"]);

    expect(await listStorageAreas(store, { organizationId: "missing" })).toEqual([]);
  });
});

describe("listStockedItems / listLocations", () => {
  it("lists stocked items and locations, excluding foreign and non-stocked rows", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    store.items.set("item-non-stock", {
      id: "item-non-stock",
      organizationId: "org",
      code: "SERVICE",
      name: "Service",
      baseUnitId: "unit",
      inventoryPolicy: "non_stock",
      lotTracked: false,
    });
    store.items.set("item-foreign", {
      id: "item-foreign",
      organizationId: "org-other",
      code: "EXT",
      name: "Foreign",
      baseUnitId: "unit",
      inventoryPolicy: "stocked",
      lotTracked: false,
    });

    const items = await listStockedItems(store, { organizationId: "org" });
    expect(items.map((item) => item.code)).toEqual(["ITEM"]);

    const locations = await listLocations(store, { organizationId: "org" });
    expect(locations.map((location) => location.code)).toEqual(["MAIN", "OTHER", "TRANSIT"]);
  });
});
