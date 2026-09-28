import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { MAX_ITEMS_LIMIT, listItems } from "./list-items";
import { FakeMasterDataStore } from "./test-support";
import type { CatalogItemRecord } from "./types";

const ORG = "org-1";

function item(overrides: Partial<CatalogItemRecord> & { readonly id: string }): CatalogItemRecord {
  return {
    organizationId: ORG,
    code: overrides.id,
    sku: `${overrides.id}-sku`,
    name: `Item ${overrides.id}`,
    itemType: "ingredient",
    purpose: "for_use",
    baseUnitId: "unit-1",
    baseUnitCode: "g",
    inventoryPolicy: "stocked",
    lotTracked: false,
    currentCost: null,
    activeFrom: "2026-01-01",
    activeTo: null,
    ...overrides,
  };
}

function buildStore(): FakeMasterDataStore {
  const store = new FakeMasterDataStore();
  store.addCatalogItem(item({ id: "b", name: "Bananas", itemType: "ingredient" }));
  store.addCatalogItem(item({ id: "a", name: "Apples", itemType: "packaging", code: "APL" }));
  store.addCatalogItem(
    item({ id: "other-org", organizationId: "org-2", name: "Foreign", code: "ZZZ" }),
  );
  return store;
}

describe("listItems", () => {
  it("returns only the organization's items ordered by code", async () => {
    const store = buildStore();
    const page = await listItems(store, { organizationId: ORG });
    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });

  it("filters by item type and case-insensitive search over code, sku and name", async () => {
    const store = buildStore();
    const byType = await listItems(store, { organizationId: ORG, itemType: "packaging" });
    expect(byType.items.map((row) => row.id)).toEqual(["a"]);

    const byName = await listItems(store, { organizationId: ORG, search: "banan" });
    expect(byName.items.map((row) => row.id)).toEqual(["b"]);

    const bySku = await listItems(store, { organizationId: ORG, search: "b-sku" });
    expect(bySku.items.map((row) => row.id)).toEqual(["b"]);

    const byCode = await listItems(store, { organizationId: ORG, search: "APL" });
    expect(byCode.items.map((row) => row.id)).toEqual(["a"]);

    const none = await listItems(store, { organizationId: ORG, search: "zzz" });
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
  });

  it("filters by purpose (DEC-150 tabs)", async () => {
    const store = buildStore();
    store.addCatalogItem(
      item({ id: "s", code: "CAKE", name: "Cake", itemType: "finished_good", purpose: "for_sale" }),
    );
    const forSale = await listItems(store, { organizationId: ORG, purpose: "for_sale" });
    expect(forSale.items.map((row) => row.id)).toEqual(["s"]);
    expect(forSale.total).toBe(1);

    const forUse = await listItems(store, { organizationId: ORG, purpose: "for_use" });
    expect(forUse.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(forUse.total).toBe(2);
  });

  it("applies limit and offset against the total", async () => {
    const store = buildStore();
    const page = await listItems(store, { organizationId: ORG, limit: 1, offset: 1 });
    expect(page.items.map((row) => row.id)).toEqual(["b"]);
    expect(page.total).toBe(2);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(1);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listItems(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(DomainError);
    await expect(
      listItems(store, { organizationId: ORG, limit: MAX_ITEMS_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listItems(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
    await expect(listItems(store, { organizationId: ORG, limit: 1.5 })).rejects.toThrow(
      DomainError,
    );
  });
});
