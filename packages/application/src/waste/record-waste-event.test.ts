import { DomainError, STOCK_VALUE_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { postStockMovement } from "../inventory";
import { getWasteEvent } from "./get-waste-event";
import { recordWasteEvent } from "./record-waste-event";
import type { RecordWasteEventInput } from "./record-waste-event";
import { FakeWasteStore, seedWasteFixture, type WasteFixture } from "./test-support";

/** Posts an opening receipt so the waste moves against a known average (0.2500). */
async function seedStock(store: FakeWasteStore, fixture: WasteFixture): Promise<void> {
  await postStockMovement(store, {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.itemId,
    movementType: "receipt",
    sourceType: "goods_receipt",
    sourceId: "receipt-1",
    quantityDelta: "1000.000000",
    unitCost: "0.2500",
    occurredAt: "2026-01-01T10:00:00.000Z",
  });
}

function wasteInput(
  fixture: WasteFixture,
  overrides: Partial<RecordWasteEventInput> = {},
): RecordWasteEventInput {
  return {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.itemId,
    quantity: "10.000000",
    stage: "storage_expiry",
    reasonCode: "storage_expiry",
    occurredAt: "2026-01-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("recordWasteEvent", () => {
  it("records the event and posts a negative waste movement of the same magnitude", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    const result = await recordWasteEvent(store, wasteInput(fixture));

    expect(result).toMatchObject({
      quantity: "10.000000",
      value: "2.5000",
      valueMethod: "moving_average",
      currency: "NOK",
      replayed: false,
    });

    const event = store.wasteEvents.get(result.wasteEventId)!;
    expect(event).toMatchObject({
      itemId: fixture.itemId,
      productVariantId: null,
      unitId: fixture.unitId,
      stage: "storage_expiry",
      reasonCode: "storage_expiry",
      valueMethod: "moving_average",
      value: "2.5000",
      currency: "NOK",
    });

    const movement = store.stockMovements.get(result.movementId)!;
    expect(movement).toMatchObject({
      movementType: "waste",
      sourceType: "waste_event",
      sourceId: result.wasteEventId,
      quantityDelta: "-10.000000",
      unitCost: "0.2500",
      valueDelta: "-2.5000",
      unitId: fixture.unitId,
      currency: "NOK",
      reasonCode: "storage_expiry",
    });

    // The event's value is exactly the ledger movement's magnitude.
    expect(event.value).toBe(
      formatDecimal(-parseDecimal(movement.valueDelta!, STOCK_VALUE_SCALE), STOCK_VALUE_SCALE),
    );

    const balance = await store.findStockBalance({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      locationId: fixture.locationId,
      storageAreaId: fixture.storageAreaId,
      lotId: null,
    });
    expect(balance).toMatchObject({ quantityOnHand: "990.000000", valueOnHand: "247.5000" });

    expect(store.audits.map((audit) => audit.action)).toContain("waste.event.recorded");
  });

  it("resolves a product variant to its finished-good item", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    const result = await recordWasteEvent(
      store,
      wasteInput(fixture, { itemId: null, productVariantId: fixture.productVariantId }),
    );

    expect(store.wasteEvents.get(result.wasteEventId)).toMatchObject({
      itemId: null,
      productVariantId: fixture.productVariantId,
    });
    expect(store.stockMovements.get(result.movementId)).toMatchObject({
      itemId: fixture.itemId,
      quantityDelta: "-10.000000",
    });
  });

  it("requires exactly one of itemId or productVariantId", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    await expect(
      recordWasteEvent(store, wasteInput(fixture, { itemId: null })),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordWasteEvent(
        store,
        wasteInput(fixture, { itemId: fixture.itemId, productVariantId: fixture.productVariantId }),
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.wasteEvents.size).toBe(0);
  });

  it("rejects an unknown stage and a blank reason", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    await expect(
      recordWasteEvent(store, wasteInput(fixture, { stage: "not_a_stage" })),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordWasteEvent(store, wasteInput(fixture, { reasonCode: "   " })),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a non-positive quantity and a non-instant occurredAt", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    await expect(
      recordWasteEvent(store, wasteInput(fixture, { quantity: "0.000000" })),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordWasteEvent(store, wasteInput(fixture, { quantity: "-1.000000" })),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordWasteEvent(store, wasteInput(fixture, { occurredAt: "2026-01-02" })),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a non-stocked item", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    const nonStocked = "item-non-stocked";
    store.items.set(nonStocked, {
      id: nonStocked,
      organizationId: fixture.organizationId,
      code: "SERVICE",
      name: "Service",
      baseUnitId: fixture.unitId,
      inventoryPolicy: "not_stocked",
      lotTracked: false,
    });

    await expect(
      recordWasteEvent(store, wasteInput(fixture, { itemId: nonStocked })),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("replays an idempotent record without duplicating the event or the movement", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    const first = await recordWasteEvent(store, wasteInput(fixture, { idempotencyKey: "w1" }));
    const replay = await recordWasteEvent(store, wasteInput(fixture, { idempotencyKey: "w1" }));

    expect(replay.replayed).toBe(true);
    expect(replay.wasteEventId).toBe(first.wasteEventId);
    expect(replay.movementId).toBe(first.movementId);
    expect(store.wasteEvents.size).toBe(1);
    expect(store.stockMovements.size).toBe(2);
  });

  it("still guards against driving stock negative (DEC-010)", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);

    // The fake does not model transaction rollback, so the rejected attempt
    // leaves its event map entry behind; the real adapter rolls the whole
    // transaction back (see `waste.postgres.test.ts`).
    await expect(
      recordWasteEvent(store, wasteInput(fixture, { quantity: "2000.000000" })),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.stockMovements.size).toBe(1);

    const override = await recordWasteEvent(
      store,
      wasteInput(fixture, { quantity: "2000.000000", allowNegativeOverride: true }),
    );
    expect(store.stockMovements.get(override.movementId)?.quantityDelta).toBe("-2000.000000");
  });

  it("getWasteEvent is organization-scoped and rejects a blank id", async () => {
    const store = new FakeWasteStore();
    const fixture = seedWasteFixture(store);
    await seedStock(store, fixture);
    const created = await recordWasteEvent(store, wasteInput(fixture));

    expect(
      (
        await getWasteEvent(store, {
          organizationId: fixture.organizationId,
          wasteEventId: created.wasteEventId,
        })
      )?.id,
    ).toBe(created.wasteEventId);
    expect(
      await getWasteEvent(store, {
        organizationId: fixture.otherOrganizationId,
        wasteEventId: created.wasteEventId,
      }),
    ).toBeUndefined();
    await expect(
      getWasteEvent(store, { organizationId: fixture.organizationId, wasteEventId: "  " }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
