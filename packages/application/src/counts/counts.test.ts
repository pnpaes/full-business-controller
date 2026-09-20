import { describe, expect, it } from "vitest";

import { postStockMovement } from "../inventory";
import { approveStockCount } from "./approve-stock-count";
import { cancelStockCount } from "./cancel-stock-count";
import { getStockCount } from "./get-stock-count";
import { listStockCounts } from "./list-stock-counts";
import { openStockCount } from "./open-stock-count";
import { recordCountedLines } from "./record-counted-lines";
import { FakeCountStore, seedCountFixture, type CountFixture } from "./test-support";

const CUTOFF = "2026-02-01T00:00:00.000Z";

/** Posts an opening receipt so the count has a projected balance to snapshot. */
async function postOpeningReceipt(
  store: FakeCountStore,
  fixture: CountFixture,
  quantity = "10.000000",
): Promise<void> {
  await postStockMovement(store, {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.itemId,
    movementType: "receipt",
    sourceType: "goods_receipt",
    sourceId: "receipt-1",
    quantityDelta: quantity,
    unitCost: "5.0000",
    occurredAt: "2026-01-01T10:00:00.000Z",
  });
}

async function openSightedCount(
  store: FakeCountStore,
  fixture: CountFixture,
  overrides: { blind?: boolean; stockCountId?: string } = {},
): Promise<string> {
  const result = await openStockCount(store, {
    organizationId: fixture.organizationId,
    actorId: "actor",
    locationId: fixture.locationId,
    cutoff: CUTOFF,
    blind: overrides.blind ?? false,
    ...(overrides.stockCountId === undefined ? {} : { stockCountId: overrides.stockCountId }),
  });
  return result.stockCountId;
}

describe("openStockCount", () => {
  it("snapshots one expected line per balance group at the cutoff", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);

    const result = await openStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      cutoff: CUTOFF,
      blind: false,
    });

    expect(result.replayed).toBe(false);
    expect(result.lineCount).toBe(1);
    const detail = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId: result.stockCountId,
    });
    expect(detail?.count).toMatchObject({ status: "counting", blind: false, scope: {} });
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]).toMatchObject({
      itemId: fixture.itemId,
      storageAreaId: fixture.storageAreaId,
      expectedQty: "10.000000",
      countedQty: null,
      varianceQty: null,
    });
  });

  it("replays a deterministic id instead of opening a second count", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = "10000000-0000-4000-8000-0000000000c1";

    const first = await openStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      cutoff: CUTOFF,
      blind: false,
      stockCountId,
    });
    const second = await openStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      locationId: fixture.locationId,
      cutoff: CUTOFF,
      blind: false,
      stockCountId,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.stockCountId).toBe(first.stockCountId);
    expect(store.stockCounts.size).toBe(1);
    expect(store.stockCountLines.size).toBe(1);
  });

  it("rejects a location from another organization", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);

    await expect(
      openStockCount(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: "actor",
        locationId: fixture.locationId,
        cutoff: CUTOFF,
        blind: false,
      }),
    ).rejects.toThrow(/location not found in organization/);
    expect(store.stockCounts.size).toBe(0);
  });
});

describe("blind counts (DEC-017)", () => {
  it("hides expected quantities until an approved blind count is revealed", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture, { blind: true });

    const hidden = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId,
    });
    expect(hidden?.expectedHidden).toBe(true);
    expect(hidden?.lines[0]?.expectedQty).toBeNull();
    expect(hidden?.lines[0]?.varianceQty).toBeNull();

    const summary = await listStockCounts(store, { organizationId: fixture.organizationId });
    expect(summary[0]?.varianceCount).toBeNull();

    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "8.000000",
        },
      ],
    });
    await approveStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      unitCost: "5.0000",
    });

    const revealed = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId,
    });
    expect(revealed?.expectedHidden).toBe(false);
    expect(revealed?.lines[0]).toMatchObject({
      expectedQty: "10.000000",
      countedQty: "8.000000",
      varianceQty: "-2.000000",
    });
  });
});

describe("recordCountedLines", () => {
  it("records an observation and flags a second observation as a recount", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);

    const first = await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "8.000000",
        },
      ],
    });
    expect(first).toEqual({ recorded: 1, recounted: 0 });

    const second = await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "7.000000",
          reasonCode: "blurred scale",
        },
      ],
    });
    expect(second).toEqual({ recorded: 0, recounted: 1 });

    const detail = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId,
    });
    expect(detail?.lines[0]).toMatchObject({
      countedQty: "7.000000",
      recount: true,
      reasonCode: "blurred scale",
    });
  });

  it("creates a discovered line with a zero expected snapshot", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);

    const result = await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.secondItemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "3.000000",
        },
      ],
    });

    expect(result).toEqual({ recorded: 1, recounted: 0 });
    const detail = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId,
    });
    const discovered = detail?.lines.find((line) => line.itemId === fixture.secondItemId);
    expect(discovered).toMatchObject({ expectedQty: "0.000000", countedQty: "3.000000" });
  });

  it("rejects a negative observation and an empty submission", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    const stockCountId = await openSightedCount(store, fixture);

    await expect(
      recordCountedLines(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
        lines: [],
      }),
    ).rejects.toThrow(/must not be empty/);

    await expect(
      recordCountedLines(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
        lines: [
          {
            itemId: fixture.itemId,
            storageAreaId: fixture.storageAreaId,
            countedQty: "-1.000000",
          },
        ],
      }),
    ).rejects.toThrow(/must not be negative/);
  });
});

describe("approveStockCount", () => {
  it("posts one count_adjustment for a negative variance at the moving average", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);
    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "8.000000",
        },
      ],
    });

    const result = await approveStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
    });

    expect(result).toMatchObject({ varianceCount: 1, status: "approved" });
    expect(result.movementIds).toHaveLength(1);
    const movement = store.stockMovements.get(result.movementIds[0]!);
    expect(movement).toMatchObject({
      movementType: "count_adjustment",
      sourceType: "stock_count",
      sourceId: stockCountId,
      quantityDelta: "-2.000000",
      valueDelta: "-10.0000",
      unitCost: "5.0000",
      occurredAt: CUTOFF,
      reasonCode: "count adjustment",
    });

    const detail = await getStockCount(store, {
      organizationId: fixture.organizationId,
      stockCountId,
    });
    expect(detail?.count).toMatchObject({ status: "approved", approvedBy: "actor" });
    expect(detail?.count.approvedAt).not.toBeNull();
    expect(detail?.lines[0]?.varianceQty).toBe("-2.000000");
  });

  it("values a positive variance at the item current_cost fallback", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);
    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "13.000000",
        },
      ],
    });

    const result = await approveStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
    });
    const movement = store.stockMovements.get(result.movementIds[0]!);
    expect(movement).toMatchObject({
      quantityDelta: "3.000000",
      unitCost: "5.0000",
      valueDelta: "15.0000",
    });
  });

  it("rejects a positive variance when neither a unit cost nor a current_cost exists", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    store.itemCosts.delete(fixture.itemId);
    const stockCountId = await openSightedCount(store, fixture);
    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "13.000000",
        },
      ],
    });

    await expect(
      approveStockCount(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
      }),
    ).rejects.toThrow(/positive count variance requires a unit cost/);

    // The failed approval must not post or approve anything.
    expect(store.stockMovements.size).toBe(1); // the opening receipt only
    expect(
      (await getStockCount(store, { organizationId: fixture.organizationId, stockCountId }))?.count
        .status,
    ).toBe("counting");
  });

  it("approves a count with no variance without posting a movement", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);
    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        {
          itemId: fixture.itemId,
          storageAreaId: fixture.storageAreaId,
          countedQty: "10.000000",
        },
      ],
    });

    const result = await approveStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
    });
    expect(result).toEqual({ movementIds: [], varianceCount: 0, status: "approved" });
    expect(store.stockMovements.size).toBe(1);
  });

  it("rejects approving a count from another organization", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    const stockCountId = await openSightedCount(store, fixture);

    await expect(
      approveStockCount(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: "actor",
        stockCountId,
      }),
    ).rejects.toThrow(/not found in organization/);
  });
});

describe("cancelStockCount", () => {
  it("cancels an open count and blocks later recording or approval", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);

    const result = await cancelStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
    });
    expect(result.status).toBe("cancelled");

    await expect(
      recordCountedLines(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
        lines: [
          { itemId: fixture.itemId, storageAreaId: fixture.storageAreaId, countedQty: "9.000000" },
        ],
      }),
    ).rejects.toThrow(/already cancelled/);
    await expect(
      approveStockCount(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
      }),
    ).rejects.toThrow(/already cancelled/);
  });

  it("refuses to cancel an approved count", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);
    await approveStockCount(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
    });

    await expect(
      cancelStockCount(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        stockCountId,
      }),
    ).rejects.toThrow(/approved count cannot be cancelled/);
  });
});

describe("listStockCounts", () => {
  it("summarises line, counted and variance counts for sighted counts", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await postOpeningReceipt(store, fixture);
    const stockCountId = await openSightedCount(store, fixture);
    await recordCountedLines(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      stockCountId,
      lines: [
        { itemId: fixture.itemId, storageAreaId: fixture.storageAreaId, countedQty: "8.000000" },
      ],
    });

    const summaries = await listStockCounts(store, { organizationId: fixture.organizationId });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      lineCount: 1,
      countedCount: 1,
      varianceCount: 1,
    });
    expect(summaries[0]?.count.id).toBe(stockCountId);
  });

  it("never returns another organization's counts", async () => {
    const store = new FakeCountStore();
    const fixture = seedCountFixture(store);
    await openSightedCount(store, fixture);

    const summaries = await listStockCounts(store, {
      organizationId: fixture.otherOrganizationId,
    });
    expect(summaries).toHaveLength(0);
  });
});
