import { describe, expect, it } from "vitest";

import { postStockMovement, postStockMovements } from "./post-stock-movement";
import type { PostStockMovementInput } from "./post-stock-movement";
import { FakeInventoryStore, seedInventoryFixture, type InventoryFixture } from "./test-support";

/** Counts the transaction-immutable reference reads so the batch memoisation is observable. */
class CountingInventoryStore extends FakeInventoryStore {
  readonly referenceCalls = {
    findOrganization: 0,
    findItem: 0,
    findLocation: 0,
    findStorageArea: 0,
    findUnit: 0,
  };

  override findOrganization(organizationId: string) {
    this.referenceCalls.findOrganization += 1;
    return super.findOrganization(organizationId);
  }

  override findItem(itemId: string) {
    this.referenceCalls.findItem += 1;
    return super.findItem(itemId);
  }

  override findLocation(locationId: string) {
    this.referenceCalls.findLocation += 1;
    return super.findLocation(locationId);
  }

  override findStorageArea(storageAreaId: string) {
    this.referenceCalls.findStorageArea += 1;
    return super.findStorageArea(storageAreaId);
  }

  override findUnit(unitId: string) {
    this.referenceCalls.findUnit += 1;
    return super.findUnit(unitId);
  }
}

function postInput(
  fixture: InventoryFixture,
  overrides: Partial<PostStockMovementInput> = {},
): PostStockMovementInput {
  return {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.itemId,
    movementType: "receipt",
    sourceType: "goods_receipt",
    sourceId: "receipt-1",
    quantityDelta: "10.000000",
    unitCost: "5.0000",
    occurredAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("postStockMovement", () => {
  it("posts an inbound receipt then an outbound sale at the running average", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    const inbound = await postStockMovement(store, postInput(fixture));
    expect(inbound).toMatchObject({
      quantityOnHand: "10.000000",
      valueOnHand: "50.0000",
      avgUnitCost: "5.0000",
      replayed: false,
      negativeOverride: false,
    });

    const outbound = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-2.000000",
        unitCost: null,
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );
    expect(outbound).toMatchObject({
      quantityOnHand: "8.000000",
      valueOnHand: "40.0000",
      avgUnitCost: "5.0000",
    });

    const outboundMovement = store.stockMovements.get(outbound.movementId)!;
    expect(outboundMovement).toMatchObject({
      unitCost: "5.0000",
      valueDelta: "-10.0000",
      unitId: fixture.unitId,
      currency: "NOK",
      postedBy: "actor",
      reversalOfId: null,
    });
  });

  it("replays an idempotent posting without double-posting", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    const first = await postStockMovement(store, postInput(fixture, { idempotencyKey: "k1" }));
    const replay = await postStockMovement(store, postInput(fixture, { idempotencyKey: "k1" }));

    expect(replay.replayed).toBe(true);
    expect(replay.movementId).toBe(first.movementId);
    expect(replay.quantityOnHand).toBe("10.000000");
    expect(replay.negativeOverride).toBe(false);
    expect(store.stockMovements.size).toBe(1);
    expect(store.stockBalances.size).toBe(1);
  });

  it("rejects a single idempotency key containing ':'", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      postStockMovement(store, postInput(fixture, { idempotencyKey: "key:0" })),
    ).rejects.toThrow(/must not contain ':'/);
    expect(store.stockMovements.size).toBe(0);
    expect(store.stockBalances.size).toBe(0);
  });

  it("rejects an item, location or storage area from another organization", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    store.items.set("item-other", {
      id: "item-other",
      organizationId: fixture.otherOrganizationId,
      code: "ITEM-OTHER",
      name: "Other item",
      baseUnitId: fixture.unitId,
      inventoryPolicy: "stocked",
      lotTracked: false,
    });
    store.locations.set("loc-other-org", {
      id: "loc-other-org",
      organizationId: fixture.otherOrganizationId,
      code: "X",
      name: "X",
      kind: "operating",
    });
    store.storageAreas.set("area-other-org", {
      id: "area-other-org",
      organizationId: fixture.otherOrganizationId,
      locationId: "loc-other-org",
      code: "X",
      name: "X",
      kind: "other",
      isTransit: false,
    });

    await expect(
      postStockMovement(store, postInput(fixture, { itemId: "item-other" })),
    ).rejects.toThrow(/item not found in organization/);
    await expect(
      postStockMovement(store, postInput(fixture, { locationId: "loc-other-org" })),
    ).rejects.toThrow(/location not found in organization/);
    await expect(
      postStockMovement(store, postInput(fixture, { storageAreaId: "area-other-org" })),
    ).rejects.toThrow(/storage area not found in organization/);
  });

  it("rejects a storage area that does not belong to the location", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.storageAreas.set("area-elsewhere", {
      id: "area-elsewhere",
      organizationId: fixture.organizationId,
      locationId: fixture.otherLocationId,
      code: "X",
      name: "X",
      kind: "other",
      isTransit: false,
    });

    await expect(
      postStockMovement(store, postInput(fixture, { storageAreaId: "area-elsewhere" })),
    ).rejects.toThrow(/storage area does not belong to the location/);
  });

  it("rejects an item that does not hold stock", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.items.set("item-non-stock", {
      id: "item-non-stock",
      organizationId: fixture.organizationId,
      code: "ITEM-NON-STOCK",
      name: "Non-stock item",
      baseUnitId: fixture.unitId,
      inventoryPolicy: "non_stock",
      lotTracked: false,
    });

    await expect(
      postStockMovement(store, postInput(fixture, { itemId: "item-non-stock" })),
    ).rejects.toThrow(/item does not hold stock/);
  });

  it("rejects an item whose base unit is missing", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.items.set("item-bad-unit", {
      id: "item-bad-unit",
      organizationId: fixture.organizationId,
      code: "ITEM-BAD-UNIT",
      name: "Bad unit item",
      baseUnitId: "missing-unit",
      inventoryPolicy: "stocked",
      lotTracked: false,
    });

    await expect(
      postStockMovement(store, postInput(fixture, { itemId: "item-bad-unit" })),
    ).rejects.toThrow(/unit not found in organization/);
  });

  it("requires a reason for adjustment/waste types", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      postStockMovement(
        store,
        postInput(fixture, { movementType: "waste", sourceType: "waste_event" }),
      ),
    ).rejects.toThrow(/reasonCode is required for waste/);
    await expect(
      postStockMovement(
        store,
        postInput(fixture, { movementType: "count_adjustment", sourceType: "stock_count" }),
      ),
    ).rejects.toThrow(/reasonCode is required for count_adjustment/);

    const adjusted = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "count_adjustment",
        sourceType: "stock_count",
        sourceId: "count-1",
        quantityDelta: "1.000000",
        unitCost: "2.0000",
        reasonCode: "count-variance",
      }),
    );
    expect(adjusted.quantityOnHand).toBe("1.000000");
  });

  it("blocks a negative posting then allows it only with a reason override", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "1.000000", unitCost: "5.0000" }),
    );

    await expect(
      postStockMovement(
        store,
        postInput(fixture, {
          movementType: "sale_consumption",
          sourceType: "sales_line",
          sourceId: "sale-2",
          quantityDelta: "-2.000000",
          unitCost: null,
        }),
      ),
    ).rejects.toThrow(/posting would drive stock negative/);

    await expect(
      postStockMovement(
        store,
        postInput(fixture, {
          movementType: "sale_consumption",
          sourceType: "sales_line",
          sourceId: "count-2",
          quantityDelta: "-2.000000",
          unitCost: null,
          allowNegativeOverride: true,
        }),
      ),
    ).rejects.toThrow(/allowNegativeOverride requires a reasonCode/);

    const overridden = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "count_adjustment",
        sourceType: "stock_count",
        sourceId: "count-2",
        quantityDelta: "-2.000000",
        unitCost: null,
        reasonCode: "emergency",
        allowNegativeOverride: true,
      }),
    );
    expect(overridden.negativeOverride).toBe(true);
    expect(overridden.quantityOnHand).toBe("-1.000000");
    expect(store.audits.at(-1)?.after).toMatchObject({ negative_override: true });
  });

  it("rejects a negative override when the actor holds no qualifying role", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "1.000000", unitCost: "5.0000" }),
    );

    await expect(
      postStockMovement(
        store,
        postInput(fixture, {
          actorId: "actor-without-role",
          movementType: "count_adjustment",
          sourceType: "stock_count",
          sourceId: "count-1",
          quantityDelta: "-2.000000",
          unitCost: null,
          reasonCode: "emergency",
          allowNegativeOverride: true,
        }),
      ),
    ).rejects.toThrow(/negative stock override requires manager permission/);
    // The override is denied before the movement is written.
    expect(store.stockMovements.size).toBe(1);
  });

  it("allows a negative override for the manager roles (DEC-010)", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "1.000000", unitCost: "5.0000" }),
    );

    for (const role of ["general_manager", "location_manager"] as const) {
      const actorId = `actor-${role}`;
      store.actorRoles.set(actorId, [role]);
      const overridden = await postStockMovement(
        store,
        postInput(fixture, {
          actorId,
          movementType: "count_adjustment",
          sourceType: "stock_count",
          sourceId: `count-${role}`,
          quantityDelta: "-2.000000",
          unitCost: null,
          reasonCode: "emergency",
          allowNegativeOverride: true,
        }),
      );
      expect(overridden.negativeOverride).toBe(true);
    }
  });

  it("creates a lot once and reuses it, and rejects a foreign lot", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.items.set(fixture.itemId, { ...store.items.get(fixture.itemId)!, lotTracked: true });

    const first = await postStockMovement(
      store,
      postInput(fixture, { lot: { lotNumber: "L1", expiryDate: "2026-12-01" } }),
    );
    const lotId = [...store.stockLots.values()][0]!.id;
    expect(store.stockLots.get(lotId)).toMatchObject({
      lotNumber: "L1",
      expiryDate: "2026-12-01",
      itemId: fixture.itemId,
      locationId: fixture.locationId,
    });
    expect(store.stockMovements.get(first.movementId)?.lotId).toBe(lotId);

    const second = await postStockMovement(
      store,
      postInput(fixture, {
        quantityDelta: "5.000000",
        occurredAt: "2026-01-02T10:00:00.000Z",
        lot: { lotNumber: "L1" },
      }),
    );
    expect(store.stockLots.size).toBe(1);
    expect(store.stockMovements.get(second.movementId)?.lotId).toBe(lotId);

    store.stockLots.set("foreign-lot", {
      id: "foreign-lot",
      organizationId: fixture.organizationId,
      itemId: "another-item",
      locationId: fixture.locationId,
      lotNumber: "F",
      expiryDate: null,
      openedDate: null,
      receivedAt: null,
      sourceMovementId: null,
    });
    await expect(
      postStockMovement(store, postInput(fixture, { lotId: "foreign-lot" })),
    ).rejects.toThrow(/lot does not belong to the item/);

    store.stockLots.set("wrong-location-lot", {
      id: "wrong-location-lot",
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      locationId: fixture.otherLocationId,
      lotNumber: "W",
      expiryDate: null,
      openedDate: null,
      receivedAt: null,
      sourceMovementId: null,
    });
    await expect(
      postStockMovement(store, postInput(fixture, { lotId: "wrong-location-lot" })),
    ).rejects.toThrow(/lot does not belong to the location/);
    await expect(
      postStockMovement(store, postInput(fixture, { lotId: "missing-lot" })),
    ).rejects.toThrow(/lot not found in organization/);
  });

  it("validates the vocabulary, quantity, timestamp and inbound cost", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      postStockMovement(store, postInput(fixture, { movementType: "not_a_type" })),
    ).rejects.toThrow(/movementType must be one of/);
    await expect(
      postStockMovement(store, postInput(fixture, { sourceType: "not_a_source" })),
    ).rejects.toThrow(/sourceType must be one of/);
    await expect(
      postStockMovement(store, postInput(fixture, { quantityDelta: "0.000000" })),
    ).rejects.toThrow(/must not be zero/);
    await expect(
      postStockMovement(store, postInput(fixture, { occurredAt: "not-a-date" })),
    ).rejects.toThrow(/ISO-8601 instant/);
    await expect(
      postStockMovement(store, postInput(fixture, { occurredAt: "2026-01-01" })),
    ).rejects.toThrow(/ISO-8601 instant/);
    await expect(
      postStockMovement(store, postInput(fixture, { occurredAt: "01/01/2026 10:00" })),
    ).rejects.toThrow(/ISO-8601 instant/);
    await expect(postStockMovement(store, postInput(fixture, { unitCost: "-1" }))).rejects.toThrow(
      /must not be negative/,
    );
    await expect(postStockMovement(store, postInput(fixture, { unitCost: null }))).rejects.toThrow(
      /requires a unit cost/,
    );
  });

  it("rejects a lot descriptor with a non-ISO expiry or opened date", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    await expect(
      postStockMovement(
        store,
        postInput(fixture, { lot: { lotNumber: "L1", expiryDate: "2026-6-1" } }),
      ),
    ).rejects.toThrow(/expiryDate must be an ISO date/);
    await expect(
      postStockMovement(
        store,
        postInput(fixture, { lot: { lotNumber: "L1", openedDate: "2026-06-01T00:00:00.000Z" } }),
      ),
    ).rejects.toThrow(/openedDate must be an ISO date/);
  });

  it("rejects supplying both a lotId and a lot descriptor", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.stockLots.set("lot-1", {
      id: "lot-1",
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      locationId: fixture.locationId,
      lotNumber: "L1",
      expiryDate: null,
      openedDate: null,
      receivedAt: null,
      sourceMovementId: null,
    });

    await expect(
      postStockMovement(store, postInput(fixture, { lotId: "lot-1", lot: { lotNumber: "L1" } })),
    ).rejects.toThrow(/lotId and lot must not both be supplied/);
  });

  it("normalises a zone-offset occurredAt and lot receivedAt to UTC (fake matches the adapter)", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    const posted = await postStockMovement(
      store,
      postInput(fixture, {
        occurredAt: "2026-01-01T12:00:00+02:00",
        lot: { lotNumber: "L1", receivedAt: "2026-01-01T12:00:00+02:00" },
      }),
    );

    expect(store.stockMovements.get(posted.movementId)?.occurredAt).toBe(
      "2026-01-01T10:00:00.000Z",
    );
    expect([...store.stockLots.values()][0]?.receivedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("posts a batch in one transaction and keys each line by index", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    const results = await postStockMovements(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      sourceType: "adjustment",
      sourceId: "batch-1",
      occurredAt: "2026-01-01T10:00:00.000Z",
      idempotencyKey: "batch-key",
      movements: [
        {
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          itemId: fixture.itemId,
          movementType: "count_adjustment",
          quantityDelta: "2.000000",
          unitCost: "3.0000",
          reasonCode: "opening",
        },
        {
          locationId: fixture.locationId,
          storageAreaId: fixture.storageAreaId,
          itemId: fixture.itemId,
          movementType: "production_output",
          quantityDelta: "3.000000",
          unitCost: "4.0000",
        },
      ],
    });

    expect(results).toHaveLength(2);
    expect(store.stockMovements.size).toBe(2);
    expect(
      [...store.stockMovements.values()].map((movement) => movement.idempotencyKey).sort(),
    ).toEqual(["batch-key:0", "batch-key:1"]);
    // 2 × 3.0000 + 3 × 4.0000 = 18.0000 over 5 units => 3.6000.
    expect(results[1]).toMatchObject({
      quantityOnHand: "5.000000",
      valueOnHand: "18.0000",
      avgUnitCost: "3.6000",
    });
  });

  it("resolves each distinct reference once per batch while posting every line", async () => {
    const store = new CountingInventoryStore();
    const fixture = seedInventoryFixture(store);
    const line = {
      locationId: fixture.locationId,
      storageAreaId: fixture.storageAreaId,
      itemId: fixture.itemId,
      movementType: "count_adjustment",
      reasonCode: "opening",
    };

    const results = await postStockMovements(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      sourceType: "adjustment",
      sourceId: "batch-refs",
      occurredAt: "2026-01-01T10:00:00.000Z",
      movements: [
        { ...line, quantityDelta: "1.000000", unitCost: "1.0000" },
        { ...line, quantityDelta: "2.000000", unitCost: "2.0000" },
      ],
    });

    expect(results).toHaveLength(2);
    expect(store.stockMovements.size).toBe(2);
    expect(store.referenceCalls).toEqual({
      findOrganization: 1,
      findItem: 1,
      findLocation: 1,
      findStorageArea: 1,
      findUnit: 1,
    });
  });

  it("posts a revaluation correction when a normal posting zeroes quantity with residual value", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);

    // Reviewer's posting-path case: a receipt at a tiny unit cost, topped up,
    // leaves the derived 4 dp average at zero. 3 × 0.0001 + 27 × 0.0000 =
    // 0.0003 over 30 units, so the average rounds to 0.0000; the zeroing
    // outbound then posts no value and strands 0.0003 unless a revaluation clears
    // it (DEC-028).
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "3.000000", unitCost: "0.0001", sourceId: "receipt-a" }),
    );
    const toppedUp = await postStockMovement(
      store,
      postInput(fixture, {
        quantityDelta: "27.000000",
        unitCost: "0.0000",
        sourceId: "receipt-b",
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );
    expect(toppedUp.avgUnitCost).toBe("0.0000");

    const outbound = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-30.000000",
        unitCost: null,
        occurredAt: "2026-01-03T10:00:00.000Z",
      }),
    );

    expect(outbound).toMatchObject({
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
    });
    const revaluation = [...store.stockMovements.values()].find(
      (movement) => movement.movementType === "revaluation",
    );
    expect(revaluation).toMatchObject({
      movementType: "revaluation",
      sourceType: "revaluation",
      quantityDelta: "0.000000",
      valueDelta: "-0.0003",
      unitCost: null,
      sourceId: "sale-1",
      reasonCode: "revaluation",
    });
    expect(store.audits.map((audit) => audit.action)).toContain(
      "inventory.stock_balance.revaluation_posted",
    );
    // The posting path's correction audit must not gain a reversal field.
    const revaluationAudit = store.audits.find(
      (audit) => audit.action === "inventory.stock_balance.revaluation_posted",
    );
    expect(revaluationAudit?.after).not.toHaveProperty("reversal_of_id");
  });

  it("does not post a revaluation when the posting zeroes cleanly", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "3.000000", unitCost: "0.0001" }),
    );

    const outbound = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-3.000000",
        unitCost: null,
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );

    expect(outbound).toMatchObject({
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
    });
    expect([...store.stockMovements.values()].some((m) => m.movementType === "revaluation")).toBe(
      false,
    );
  });

  it("scopes an idempotency key per organization", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const first = await postStockMovement(
      store,
      postInput(fixture, { idempotencyKey: "shared-key" }),
    );

    // The other organization reuses the same key in its own namespace, so seed
    // its own org-scoped refs.
    store.units.set("unit-b", {
      id: "unit-b",
      organizationId: fixture.otherOrganizationId,
      code: "kg",
      dimension: "mass",
    });
    store.items.set("item-b", {
      id: "item-b",
      organizationId: fixture.otherOrganizationId,
      code: "ITEM-B",
      name: "Item B",
      baseUnitId: "unit-b",
      inventoryPolicy: "stocked",
      lotTracked: false,
    });
    store.locations.set("loc-b", {
      id: "loc-b",
      organizationId: fixture.otherOrganizationId,
      code: "B",
      name: "B",
      kind: "operating",
    });
    store.storageAreas.set("area-b", {
      id: "area-b",
      organizationId: fixture.otherOrganizationId,
      locationId: "loc-b",
      code: "B",
      name: "B",
      kind: "dry_store",
      isTransit: false,
    });
    const otherOrgInput = {
      ...postInput(fixture),
      organizationId: fixture.otherOrganizationId,
      itemId: "item-b",
      locationId: "loc-b",
      storageAreaId: "area-b",
      sourceId: "receipt-b",
      idempotencyKey: "shared-key",
    };

    const second = await postStockMovement(store, otherOrgInput);
    expect(second.replayed).toBe(false);
    expect(second.movementId).not.toBe(first.movementId);

    // A key used by one organization does not block the other's posting, and
    // each organization's replay returns its own movement.
    const replayA = await postStockMovement(
      store,
      postInput(fixture, { idempotencyKey: "shared-key" }),
    );
    const replayB = await postStockMovement(store, otherOrgInput);
    expect(replayA.movementId).toBe(first.movementId);
    expect(replayB.movementId).toBe(second.movementId);
    expect(store.stockMovements.size).toBe(2);
  });

  it("flags requires_revaluation when an override leaves quantity negative", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    await postStockMovement(
      store,
      postInput(fixture, { quantityDelta: "1.000000", unitCost: "5.0000" }),
    );

    const overridden = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "count_adjustment",
        sourceType: "stock_count",
        sourceId: "count-1",
        quantityDelta: "-2.000000",
        unitCost: null,
        reasonCode: "emergency",
        allowNegativeOverride: true,
      }),
    );

    expect(overridden.quantityOnHand).toBe("-1.000000");
    expect(store.audits.at(-1)?.after).toMatchObject({
      negative_override: true,
      requires_revaluation: true,
    });
  });

  it("validates the batch shape before opening a transaction", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const base = {
      organizationId: fixture.organizationId,
      actorId: "actor",
      sourceType: "adjustment",
      sourceId: "batch-1",
      occurredAt: "2026-01-01T10:00:00.000Z",
    };
    const one = [
      {
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        movementType: "count_adjustment",
        quantityDelta: "1.000000",
        unitCost: "1.0000",
        reasonCode: "opening",
      },
    ];

    await expect(postStockMovements(store, { ...base, movements: [] })).rejects.toThrow(
      /movements must not be empty/,
    );
    await expect(
      postStockMovements(store, { ...base, sourceType: "not_a_source", movements: one }),
    ).rejects.toThrow(/sourceType must be one of/);
    await expect(
      postStockMovements(store, { ...base, occurredAt: "2026-01-01", movements: one }),
    ).rejects.toThrow(/ISO-8601 instant/);
    await expect(
      postStockMovements(store, { ...base, idempotencyKey: "batch:0", movements: one }),
    ).rejects.toThrow(/must not contain ':'/);
    expect(store.stockMovements.size).toBe(0);
  });
});
