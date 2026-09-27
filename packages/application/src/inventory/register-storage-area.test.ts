import { describe, expect, it } from "vitest";

import { registerStorageArea } from "./register-storage-area";
import type { RegisterStorageAreaInput } from "./register-storage-area";
import { FakeInventoryStore, seedInventoryFixture, type InventoryFixture } from "./test-support";

function input(
  fixture: InventoryFixture,
  overrides: Partial<RegisterStorageAreaInput> = {},
): RegisterStorageAreaInput {
  return {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    code: "FREEZER",
    name: "Freezer",
    kind: "freezer",
    ...overrides,
  };
}

describe("registerStorageArea", () => {
  it("registers an area and writes the audit fact", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    const { storageAreaId } = await registerStorageArea(store, input(fixture));

    expect(store.storageAreas.get(storageAreaId)).toMatchObject({
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      code: "FREEZER",
      name: "Freezer",
      kind: "freezer",
      isTransit: false,
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "inventory.storage_area.registered",
      entityType: "storage_area",
      entityId: storageAreaId,
      after: { code: "FREEZER", kind: "freezer", is_transit: false },
    });
  });

  it("validates the kind and the required text fields", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      registerStorageArea(store, input(fixture, { kind: "not_a_kind" })),
    ).rejects.toThrow(/kind must be one of/);
    await expect(registerStorageArea(store, input(fixture, { code: "  " }))).rejects.toThrow(
      /code must not be blank/,
    );
    await expect(registerStorageArea(store, input(fixture, { name: "" }))).rejects.toThrow(
      /name must not be blank/,
    );
  });

  it("rejects a duplicate code in the same location but allows it elsewhere", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      registerStorageArea(store, input(fixture, { code: "DRY", name: "Dry", kind: "dry_store" })),
    ).rejects.toThrow(/storage area code already exists for this location/);

    const { storageAreaId } = await registerStorageArea(
      store,
      input(fixture, {
        locationId: fixture.otherLocationId,
        code: "DRY",
        name: "Dry",
        kind: "dry_store",
      }),
    );
    expect(store.storageAreas.get(storageAreaId)?.locationId).toBe(fixture.otherLocationId);
  });

  it("allows isTransit only on a virtual transit location", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      registerStorageArea(
        store,
        input(fixture, { code: "T1", name: "Transit", kind: "transit", isTransit: true }),
      ),
    ).rejects.toThrow(/isTransit may only be true on a virtual transit location/);

    const { storageAreaId } = await registerStorageArea(
      store,
      input(fixture, {
        locationId: fixture.transitLocationId,
        code: "T2",
        name: "Transit",
        kind: "transit",
        isTransit: true,
      }),
    );
    expect(store.storageAreas.get(storageAreaId)?.isTransit).toBe(true);
  });

  it("rejects a missing or foreign location", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.locations.set("loc-foreign", {
      id: "loc-foreign",
      organizationId: fixture.otherOrganizationId,
      code: "F",
      name: "F",
      kind: "operating",
      defaultStorageAreaId: null,
    });

    await expect(
      registerStorageArea(store, input(fixture, { locationId: "missing" })),
    ).rejects.toThrow(/location not found in organization/);
    await expect(
      registerStorageArea(store, input(fixture, { locationId: "loc-foreign" })),
    ).rejects.toThrow(/location not found in organization/);
  });
});
