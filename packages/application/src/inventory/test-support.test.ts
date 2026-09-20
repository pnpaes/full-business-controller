import { describe, expect, it } from "vitest";

import { FakeInventoryStore, seedInventoryFixture } from "./test-support";

describe("FakeInventoryStore.saveStockBalance", () => {
  it("throws when the balance row was never locked", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      store.saveStockBalance(
        {
          organizationId: fixture.organizationId,
          itemId: fixture.itemId,
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          lotId: null,
        },
        {
          quantityOnHand: "1.000000",
          valueOnHand: "1.0000",
          avgUnitCost: "1.0000",
          asOf: new Date("2026-03-05T00:00:00.000Z"),
        },
      ),
    ).rejects.toThrow(/lockStockBalance/);
  });
});
