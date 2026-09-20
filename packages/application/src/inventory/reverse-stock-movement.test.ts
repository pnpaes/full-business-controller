import { describe, expect, it } from "vitest";

import { postStockMovement } from "./post-stock-movement";
import type { PostStockMovementInput } from "./post-stock-movement";
import { reverseStockMovement } from "./reverse-stock-movement";
import { FakeInventoryStore, seedInventoryFixture, type InventoryFixture } from "./test-support";

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

describe("reverseStockMovement", () => {
  it("offsets the original exactly and marks a receipt reversal", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));

    const result = await reverseStockMovement(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      movementId: inbound.movementId,
      reasonCode: "wrong-purchase",
    });

    expect(result.revaluationMovementId).toBeNull();
    expect(result).toMatchObject({
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
    });
    const reversal = store.stockMovements.get(result.reversalMovementId)!;
    expect(reversal).toMatchObject({
      movementType: "receipt_reversal",
      quantityDelta: "-10.000000",
      valueDelta: "-50.0000",
      unitCost: "5.0000",
      reversalOfId: inbound.movementId,
      idempotencyKey: `reversal:${inbound.movementId}`,
      reasonCode: "wrong-purchase",
      sourceType: "goods_receipt",
      sourceId: "receipt-1",
      postedBy: "actor",
    });
    expect(store.audits.map((audit) => audit.action)).toContain(
      "inventory.stock_movement.reversed",
    );
  });

  it("uses a correction movement for a non-receipt original", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const original = await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "count_adjustment",
        sourceType: "stock_count",
        sourceId: "count-1",
        quantityDelta: "1.000000",
        unitCost: "2.0000",
        reasonCode: "opening",
      }),
    );

    const result = await reverseStockMovement(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      movementId: original.movementId,
      reasonCode: "miscounted",
    });
    expect(store.stockMovements.get(result.reversalMovementId)).toMatchObject({
      movementType: "correction",
      quantityDelta: "-1.000000",
      valueDelta: "-2.0000",
    });
  });

  it("rejects a movement that is already reversed", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));
    const input = {
      organizationId: fixture.organizationId,
      actorId: "actor",
      movementId: inbound.movementId,
      reasonCode: "wrong-purchase",
    };

    await reverseStockMovement(store, input);
    await expect(reverseStockMovement(store, input)).rejects.toThrow(/movement already reversed/);
  });

  it("posts a revaluation correction when a reversal leaves residual value", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    // 10 @ 5 = 50, sold back at the running average (0 value), then 10 @ 8 = 80.
    const first = await postStockMovement(store, postInput(fixture, { sourceId: "receipt-1" }));
    await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-10.000000",
        unitCost: null,
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );
    const second = await postStockMovement(
      store,
      postInput(fixture, {
        sourceId: "receipt-2",
        quantityDelta: "10.000000",
        unitCost: "8.0000",
        occurredAt: "2026-01-03T10:00:00.000Z",
      }),
    );
    expect(second).toMatchObject({
      quantityOnHand: "10.000000",
      valueOnHand: "80.0000",
      avgUnitCost: "8.0000",
    });

    const result = await reverseStockMovement(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      movementId: first.movementId,
      reasonCode: "supplier-credit",
    });

    expect(result.revaluationMovementId).not.toBeNull();
    expect(result).toMatchObject({
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
    });
    const revaluation = store.stockMovements.get(result.revaluationMovementId!)!;
    expect(revaluation).toMatchObject({
      movementType: "revaluation",
      sourceType: "revaluation",
      quantityDelta: "0.000000",
      valueDelta: "-30.0000",
      unitCost: null,
      idempotencyKey: `revaluation:${first.movementId}`,
      reasonCode: "supplier-credit",
    });
    expect(store.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "inventory.stock_movement.reversed",
        "inventory.stock_balance.revaluation_posted",
      ]),
    );
    // The reversal's correction audit carries the original movement id.
    const revaluationAudit = store.audits.find(
      (audit) => audit.action === "inventory.stock_balance.revaluation_posted",
    );
    expect(revaluationAudit?.after).toMatchObject({ reversal_of_id: first.movementId });
  });

  it("requires a non-blank reason", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        movementId: inbound.movementId,
        reasonCode: "",
      }),
    ).rejects.toThrow(/reasonCode is required/);
    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        movementId: inbound.movementId,
        reasonCode: "   ",
      }),
    ).rejects.toThrow(/reasonCode is required/);
  });

  it("rejects a movement from another organization", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: "actor",
        movementId: inbound.movementId,
        reasonCode: "wrong-org",
      }),
    ).rejects.toThrow(/movement not found in organization/);
  });

  it("records negative_override in the audit when the reversal override is used", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));
    await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-10.000000",
        unitCost: null,
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        movementId: inbound.movementId,
        reasonCode: "supplier-credit",
      }),
    ).rejects.toThrow(/posting would drive stock negative/);

    const result = await reverseStockMovement(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      movementId: inbound.movementId,
      reasonCode: "supplier-credit",
      allowNegativeOverride: true,
    });
    expect(result.quantityOnHand).toBe("-10.000000");
    const reversedAudit = store.audits.find(
      (audit) => audit.action === "inventory.stock_movement.reversed",
    );
    expect(reversedAudit?.after).toMatchObject({ negative_override: true });
  });

  it("rejects a negative reversal override when the actor holds no qualifying role", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));
    await postStockMovement(
      store,
      postInput(fixture, {
        movementType: "sale_consumption",
        sourceType: "sales_line",
        sourceId: "sale-1",
        quantityDelta: "-10.000000",
        unitCost: null,
        occurredAt: "2026-01-02T10:00:00.000Z",
      }),
    );

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor-without-role",
        movementId: inbound.movementId,
        reasonCode: "supplier-credit",
        allowNegativeOverride: true,
      }),
    ).rejects.toThrow(/negative stock override requires manager permission/);
  });

  it("rejects reversing a revaluation movement", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.stockMovements.set("reval-1", {
      id: "reval-1",
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      storageAreaId: fixture.storageAreaId,
      itemId: fixture.itemId,
      lotId: null,
      movementType: "revaluation",
      quantityDelta: "0.000000",
      unitId: fixture.unitId,
      unitCost: null,
      valueDelta: "-1.0000",
      currency: "NOK",
      sourceType: "revaluation",
      sourceId: "src",
      reversalOfId: null,
      occurredAt: "2026-01-01T10:00:00.000Z",
      postedAt: "2026-01-01T10:00:00.000Z",
      postedBy: "actor",
      reasonCode: "correction",
      idempotencyKey: null,
    });

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        movementId: "reval-1",
        reasonCode: "correction",
      }),
    ).rejects.toThrow(/revaluation movement cannot be reversed/);
  });

  it("throws when a null-currency movement's organization is missing", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    store.stockMovements.set("legacy-1", {
      id: "legacy-1",
      organizationId: "org-missing",
      locationId: fixture.locationId,
      storageAreaId: fixture.storageAreaId,
      itemId: fixture.itemId,
      lotId: null,
      movementType: "count_adjustment",
      quantityDelta: "-1.000000",
      unitId: fixture.unitId,
      unitCost: "1.0000",
      valueDelta: "-1.0000",
      currency: null,
      sourceType: "adjustment",
      sourceId: "src",
      reversalOfId: null,
      occurredAt: "2026-01-01T10:00:00.000Z",
      postedAt: "2026-01-01T10:00:00.000Z",
      postedBy: "actor",
      reasonCode: "correcting",
      idempotencyKey: null,
    });

    await expect(
      reverseStockMovement(store, {
        organizationId: "org-missing",
        actorId: "actor",
        movementId: "legacy-1",
        reasonCode: "correcting",
      }),
    ).rejects.toThrow(/organization not found/);
  });

  it("rejects a non-instant occurredAt", async () => {
    const store = new FakeInventoryStore();
    const fixture = seedInventoryFixture(store);
    const inbound = await postStockMovement(store, postInput(fixture));

    await expect(
      reverseStockMovement(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        movementId: inbound.movementId,
        reasonCode: "wrong-purchase",
        occurredAt: "2026-01-02",
      }),
    ).rejects.toThrow(/ISO-8601 instant/);
  });
});
