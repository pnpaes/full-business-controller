import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeInventoryStore, seedInventoryFixture, type InventoryFixture } from "./test-support";
import { setLocationDefaultStorageArea } from "./set-location-default-storage-area";

describe("setLocationDefaultStorageArea", () => {
  let store: FakeInventoryStore;
  let fixture: InventoryFixture;

  beforeEach(() => {
    store = new FakeInventoryStore();
    fixture = seedInventoryFixture(store);
  });

  it("sets the location's default storage area and appends an audit fact", async () => {
    // The fixture already defaults `loc` to `area`; use a second area to prove
    // the write actually changes the stored default.
    store.storageAreas.set("area-2", {
      id: "area-2",
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      code: "CHILL",
      name: "Chiller",
      kind: "chilled",
      isTransit: false,
    });

    const result = await setLocationDefaultStorageArea(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      storageAreaId: "area-2",
    });

    expect(result).toEqual({ locationId: fixture.locationId, storageAreaId: "area-2" });
    expect(store.locations.get(fixture.locationId)?.defaultStorageAreaId).toBe("area-2");
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: "inventory.location.default_storage_area_set",
      entityType: "location",
      entityId: fixture.locationId,
      after: { default_storage_area_id: "area-2" },
    });
  });

  it("rejects an area that belongs to a different location", async () => {
    await expect(
      setLocationDefaultStorageArea(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: fixture.otherLocationId,
        storageAreaId: fixture.storageAreaId,
      }),
    ).rejects.toThrow("storage area does not belong to the location");
    expect(store.locations.get(fixture.otherLocationId)?.defaultStorageAreaId).toBeNull();
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a location outside the organization and a foreign area", async () => {
    await expect(
      setLocationDefaultStorageArea(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: "missing-location",
        storageAreaId: fixture.storageAreaId,
      }),
    ).rejects.toThrow(DomainError);

    await expect(
      setLocationDefaultStorageArea(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        locationId: fixture.locationId,
        storageAreaId: "missing-area",
      }),
    ).rejects.toThrow("storage area not found in organization");
  });
});
