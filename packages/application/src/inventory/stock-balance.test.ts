import { describe, expect, it } from "vitest";

import { getStockBalanceAsOf } from "./stock-balance";
import { FakeInventoryStore, seedInventoryFixture } from "./test-support";
import type { NewStockMovementRecord } from "./types";

function movement(overrides: Partial<NewStockMovementRecord>): NewStockMovementRecord {
  return {
    organizationId: "org",
    locationId: "loc",
    storageAreaId: "area",
    itemId: "item",
    lotId: null,
    movementType: "receipt",
    quantityDelta: "0.000000",
    unitId: "unit",
    unitCost: "0.0000",
    valueDelta: "0.0000",
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

describe("getStockBalanceAsOf", () => {
  it("returns an empty list when there are no movements", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    expect(
      await getStockBalanceAsOf(store, {
        organizationId: "org",
        asOf: "2026-12-31T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects an asOf that is not a full ISO instant", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await expect(
      getStockBalanceAsOf(store, { organizationId: "org", asOf: "2026-12-31" }),
    ).rejects.toThrow(/ISO-8601 instant/);
  });

  it("aggregates each group from the movements at the cutoff", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await store.createStockMovement(
      movement({
        quantityDelta: "10.000000",
        valueDelta: "50.0000",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await store.createStockMovement(
      movement({
        itemId: "item-2",
        quantityDelta: "1.000000",
        valueDelta: "2.0000",
        occurredAt: "2026-01-15T00:00:00.000Z",
      }),
    );
    await store.createStockMovement(
      movement({
        quantityDelta: "-2.000000",
        valueDelta: "-10.0000",
        occurredAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    await store.createStockMovement(
      movement({
        quantityDelta: "5.000000",
        valueDelta: "40.0000",
        occurredAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    expect(
      await getStockBalanceAsOf(store, {
        organizationId: "org",
        asOf: "2026-02-15T00:00:00.000Z",
      }),
    ).toEqual([
      {
        organizationId: "org",
        itemId: "item",
        locationId: "loc",
        storageAreaId: "area",
        lotId: null,
        quantityOnHand: "8.000000",
        valueOnHand: "40.0000",
        avgUnitCost: "5.0000",
      },
      {
        organizationId: "org",
        itemId: "item-2",
        locationId: "loc",
        storageAreaId: "area",
        lotId: null,
        quantityOnHand: "1.000000",
        valueOnHand: "2.0000",
        avgUnitCost: "2.0000",
      },
    ]);

    expect(
      await getStockBalanceAsOf(store, {
        organizationId: "org",
        asOf: "2026-03-15T00:00:00.000Z",
      }),
    ).toEqual([
      expect.objectContaining({
        itemId: "item",
        quantityOnHand: "13.000000",
        valueOnHand: "80.0000",
        avgUnitCost: "6.1538",
      }),
      expect.objectContaining({ itemId: "item-2" }),
    ]);
  });

  it("keeps a null-lot group separate from a lot-specific group", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await store.createStockMovement(
      movement({ quantityDelta: "2.000000", valueDelta: "10.0000", lotId: null }),
    );
    await store.createStockMovement(
      movement({
        quantityDelta: "3.000000",
        valueDelta: "12.0000",
        lotId: "lot-a",
        occurredAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    expect(
      await getStockBalanceAsOf(store, {
        organizationId: "org",
        asOf: "2026-12-31T00:00:00.000Z",
      }),
    ).toEqual([
      {
        organizationId: "org",
        itemId: "item",
        locationId: "loc",
        storageAreaId: "area",
        lotId: null,
        quantityOnHand: "2.000000",
        valueOnHand: "10.0000",
        avgUnitCost: "5.0000",
      },
      {
        organizationId: "org",
        itemId: "item",
        locationId: "loc",
        storageAreaId: "area",
        lotId: "lot-a",
        quantityOnHand: "3.000000",
        valueOnHand: "12.0000",
        avgUnitCost: "4.0000",
      },
    ]);

    // A cutoff before the lot-specific movement drops that group entirely.
    expect(
      await getStockBalanceAsOf(store, {
        organizationId: "org",
        asOf: "2026-01-01T12:00:00.000Z",
      }),
    ).toEqual([
      {
        organizationId: "org",
        itemId: "item",
        locationId: "loc",
        storageAreaId: "area",
        lotId: null,
        quantityOnHand: "2.000000",
        valueOnHand: "10.0000",
        avgUnitCost: "5.0000",
      },
    ]);
  });

  it("filters by item and location", async () => {
    const store = new FakeInventoryStore();
    seedInventoryFixture(store);
    await store.createStockMovement(movement({ quantityDelta: "1.000000", valueDelta: "1.0000" }));
    await store.createStockMovement(
      movement({ itemId: "item-2", quantityDelta: "2.000000", valueDelta: "2.0000" }),
    );
    await store.createStockMovement(
      movement({
        locationId: "loc-other",
        quantityDelta: "3.000000",
        valueDelta: "3.0000",
      }),
    );

    const byItem = await getStockBalanceAsOf(store, {
      organizationId: "org",
      asOf: "2026-12-31T00:00:00.000Z",
      itemId: "item",
    });
    expect(byItem.map((entry) => entry.locationId).sort()).toEqual(["loc", "loc-other"]);

    const byLocation = await getStockBalanceAsOf(store, {
      organizationId: "org",
      asOf: "2026-12-31T00:00:00.000Z",
      locationId: "loc-other",
    });
    expect(byLocation).toEqual([
      expect.objectContaining({ locationId: "loc-other", quantityOnHand: "3.000000" }),
    ]);
  });
});
