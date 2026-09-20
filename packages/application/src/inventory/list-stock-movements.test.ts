import { describe, expect, it } from "vitest";

import { listStockMovements } from "./list-stock-movements";
import { FakeInventoryStore, seedInventoryFixture } from "./test-support";
import type { NewStockMovementRecord } from "./types";

function movement(overrides: Partial<NewStockMovementRecord> = {}): NewStockMovementRecord {
  return {
    organizationId: "org",
    locationId: "loc",
    storageAreaId: "area",
    itemId: "item",
    lotId: null,
    movementType: "receipt",
    quantityDelta: "1.000000",
    unitId: "unit",
    unitCost: "1.0000",
    valueDelta: "1.0000",
    currency: "NOK",
    sourceType: "adjustment",
    sourceId: "src",
    reversalOfId: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    postedBy: "actor",
    reasonCode: null,
    idempotencyKey: null,
    ...overrides,
  };
}

describe("listStockMovements", () => {
  it("returns an empty page when there are no movements", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    expect(await listStockMovements(store, { organizationId: "org" })).toEqual({
      movements: [],
      limit: 50,
      offset: 0,
      hasMore: false,
    });
  });

  it("rejects a malformed instant, limit and offset", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await expect(
      listStockMovements(store, { organizationId: "org", occurredFrom: "2026-01-01" }),
    ).rejects.toThrow(/ISO-8601 instant/);
    await expect(listStockMovements(store, { organizationId: "org", limit: 0 })).rejects.toThrow(
      /limit/,
    );
    await expect(listStockMovements(store, { organizationId: "org", limit: 201 })).rejects.toThrow(
      /limit/,
    );
    await expect(listStockMovements(store, { organizationId: "org", offset: -1 })).rejects.toThrow(
      /offset/,
    );
  });

  it("returns the ledger in occurred-at order and drops other organizations", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await store.createStockMovement(
      movement({ occurredAt: "2026-02-01T00:00:00.000Z", quantityDelta: "2.000000" }),
    );
    await store.createStockMovement(
      movement({ occurredAt: "2026-01-01T00:00:00.000Z", quantityDelta: "1.000000" }),
    );
    await store.createStockMovement(
      movement({ organizationId: "org-other", quantityDelta: "9.000000" }),
    );

    const page = await listStockMovements(store, { organizationId: "org" });
    expect(page.movements.map((row) => row.quantityDelta)).toEqual(["1.000000", "2.000000"]);
  });

  it("applies item, location, storage area, lot and date filters", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    const matching = await store.createStockMovement(
      movement({
        occurredAt: "2026-02-01T00:00:00.000Z",
        itemId: "item-2",
        locationId: "loc-other",
        storageAreaId: "area-other",
        lotId: "lot-a",
      }),
    );
    await store.createStockMovement(
      movement({ itemId: "item-3", occurredAt: "2026-02-01T00:00:00.000Z" }),
    );
    await store.createStockMovement(
      movement({ occurredAt: "2026-06-01T00:00:00.000Z", itemId: "item-2" }),
    );

    const page = await listStockMovements(store, {
      organizationId: "org",
      itemId: "item-2",
      locationId: "loc-other",
      storageAreaId: "area-other",
      lotId: "lot-a",
      occurredFrom: "2026-01-01T00:00:00.000Z",
      occurredTo: "2026-03-01T00:00:00.000Z",
    });
    expect(page.movements.map((row) => row.id)).toEqual([matching.id]);
  });

  it("distinguishes a null-lot filter from an absent one", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    const untracked = await store.createStockMovement(movement({ lotId: null }));
    const tracked = await store.createStockMovement(movement({ lotId: "lot-a" }));

    const nullLots = await listStockMovements(store, { organizationId: "org", lotId: null });
    expect(nullLots.movements.map((row) => row.id)).toEqual([untracked.id]);
    const thisLot = await listStockMovements(store, { organizationId: "org", lotId: "lot-a" });
    expect(thisLot.movements.map((row) => row.id)).toEqual([tracked.id]);
    expect((await listStockMovements(store, { organizationId: "org" })).movements).toHaveLength(2);
  });

  it("pages with limit/offset and reports hasMore", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    for (let day = 1; day <= 3; day += 1) {
      await store.createStockMovement(
        movement({ occurredAt: `2026-01-0${day}T00:00:00.000Z`, quantityDelta: `${day}.000000` }),
      );
    }

    const first = await listStockMovements(store, { organizationId: "org", limit: 2 });
    expect(first.movements).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.movements.map((row) => row.quantityDelta)).toEqual(["1.000000", "2.000000"]);

    const second = await listStockMovements(store, {
      organizationId: "org",
      limit: 2,
      offset: 2,
    });
    expect(second.movements).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.movements.map((row) => row.quantityDelta)).toEqual(["3.000000"]);
  });
});
