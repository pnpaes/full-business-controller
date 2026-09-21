import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { approveStockTransfer } from "./approve-stock-transfer";
import { cancelStockTransfer } from "./cancel-stock-transfer";
import { dispatchStockTransfer } from "./dispatch-stock-transfer";
import { getStockTransfer, listStockTransfers, summarizeTransferMovements } from "./reads";
import { receiveStockTransfer } from "./receive-stock-transfer";
import { requestStockTransfer } from "./request-stock-transfer";
import { FakeTransferStore, seedTransferFixture, type TransferFixture } from "./test-support";
import type { TransferMovementRecord } from "./types";

interface Setup {
  readonly store: FakeTransferStore;
  readonly fixture: TransferFixture;
}

async function setup(): Promise<Setup> {
  const store = new FakeTransferStore();
  const fixture = await seedTransferFixture(store);
  return { store, fixture };
}

function requestInput(fixture: TransferFixture) {
  return {
    organizationId: fixture.organizationId,
    actorId: "actor",
    fromLocationId: fixture.locationId,
    fromStorageAreaId: fixture.storageAreaId,
    toLocationId: fixture.otherLocationId,
    toStorageAreaId: fixture.toStorageAreaId,
  };
}

async function request(setup: Setup, overrides: Record<string, string> = {}): Promise<string> {
  const { transferId } = await requestStockTransfer(setup.store, {
    ...requestInput(setup.fixture),
    ...overrides,
  });
  return transferId;
}

async function approve(setup: Setup, transferId: string): Promise<void> {
  await approveStockTransfer(setup.store, {
    organizationId: setup.fixture.organizationId,
    actorId: "actor",
    transferId,
  });
}

async function dispatch(setup: Setup, transferId: string, quantity = "10.000000"): Promise<void> {
  await dispatchStockTransfer(setup.store, {
    organizationId: setup.fixture.organizationId,
    actorId: "actor",
    transferId,
    lines: [{ itemId: setup.fixture.itemId, quantity }],
  });
}

function findBalance(
  setup: Setup,
  locationId: string,
  storageAreaId: string,
): Promise<
  { quantityOnHand: string; valueOnHand: string; avgUnitCost: string | null } | undefined
> {
  return setup.store.findStockBalance({
    organizationId: setup.fixture.organizationId,
    itemId: setup.fixture.itemId,
    locationId,
    storageAreaId,
    lotId: null,
  });
}

describe("transfers command flow", () => {
  it("dispatches source→transit and receives transit→destination with paired legs", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId);

    const dispatched = await store.findStockTransfer({
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(dispatched).toMatchObject({ status: "dispatched" });
    expect(dispatched?.dispatchedAt).not.toBeNull();
    expect(dispatched?.dispatchMovementId).not.toBeNull();

    const dispatchMovements = await store.listStockMovementsByTransferId({
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(dispatchMovements).toHaveLength(2);
    expect(dispatchMovements.every((movement) => movement.transferId === transferId)).toBe(true);
    expect(dispatchMovements.every((m) => m.movementType === "transfer_dispatch")).toBe(true);

    // Source 100 → 90 at the same 0.2500 average; transit holds the 10.
    const source = await findBalance(context, fixture.locationId, fixture.storageAreaId);
    expect(source).toMatchObject({
      quantityOnHand: "90.000000",
      valueOnHand: "22.5000",
      avgUnitCost: "0.2500",
    });
    const transit = await findBalance(
      context,
      fixture.transitLocationId,
      fixture.transitStorageAreaId,
    );
    expect(transit).toMatchObject({
      quantityOnHand: "10.000000",
      valueOnHand: "2.5000",
      avgUnitCost: "0.2500",
    });

    await receiveStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      received: [{ itemId: fixture.itemId, quantity: "10.000000" }],
    });

    const received = await store.findStockTransfer({
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(received).toMatchObject({ status: "received" });
    expect(received?.receivedAt).not.toBeNull();
    expect(received?.receiptMovementId).not.toBeNull();
    expect(received?.discrepancyNote).toBeNull();

    const destination = await findBalance(
      context,
      fixture.otherLocationId,
      fixture.toStorageAreaId,
    );
    expect(destination).toMatchObject({
      quantityOnHand: "10.000000",
      valueOnHand: "2.5000",
      avgUnitCost: "0.2500",
    });
    const transitAfter = await findBalance(
      context,
      fixture.transitLocationId,
      fixture.transitStorageAreaId,
    );
    expect(transitAfter).toMatchObject({ quantityOnHand: "0.000000", valueOnHand: "0.0000" });

    // The transit leg nets to zero: the goods live at the destination only, and
    // the organization's total quantity/value is unchanged (INV-009).
    const detail = await getStockTransfer(store, {
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(detail?.hasDiscrepancy).toBe(false);
    expect(detail?.dispatchedQuantity).toBe("10.000000");
    expect(detail?.receivedQuantity).toBe("10.000000");
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]).toMatchObject({
      itemId: fixture.itemId,
      dispatchedQuantity: "10.000000",
      receivedQuantity: "10.000000",
      hasDiscrepancy: false,
    });
  });

  it("records a discrepancy note when the received quantity is short", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId, "10.000000");

    const result = await receiveStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      received: [{ itemId: fixture.itemId, quantity: "8.000000" }],
    });
    expect(result.hasDiscrepancy).toBe(true);
    expect(result.discrepancyNote).toMatch(/differs from dispatched/);

    const transfer = await store.findStockTransfer({
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(transfer?.discrepancyNote).toBe(result.discrepancyNote);

    // The 2 units still in transit are the recorded exception (DEC-029).
    const transit = await findBalance(
      context,
      fixture.transitLocationId,
      fixture.transitStorageAreaId,
    );
    expect(transit).toMatchObject({
      quantityOnHand: "2.000000",
      valueOnHand: "0.5000",
    });

    const detail = await getStockTransfer(store, {
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(detail?.lines[0]).toMatchObject({
      dispatchedQuantity: "10.000000",
      receivedQuantity: "8.000000",
      hasDiscrepancy: true,
    });
  });

  it("records exactly one transfer_discrepancy exception on a short receipt (DEC-080)", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId, "10.000000");

    await receiveStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      received: [{ itemId: fixture.itemId, quantity: "8.000000" }],
      occurredAt: "2026-09-03T08:00:00.000Z",
    });

    const exceptions = [...store.dataQualityExceptions.values()];
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      organizationId: fixture.organizationId,
      ruleCode: "transfer_discrepancy",
      severity: "high",
      entityType: "stock_transfer",
      entityId: transferId,
      detectedAt: "2026-09-03T08:00:00.000Z",
      status: "open",
      resolution: null,
    });

    // The audit payload carries the exception id beside the human note.
    const received = store.audits.find((entry) => entry.action === "inventory.transfer.received");
    expect(received?.after).toMatchObject({
      exception_id: exceptions[0]?.id,
      has_discrepancy: true,
    });
  });

  it("records no exception on a clean receipt (DEC-080)", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId, "10.000000");

    await receiveStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      received: [{ itemId: fixture.itemId, quantity: "10.000000" }],
    });

    expect([...store.dataQualityExceptions.values()]).toHaveLength(0);
  });

  it("keeps a caller-supplied discrepancy note", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId, "10.000000");

    const result = await receiveStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      received: [{ itemId: fixture.itemId, quantity: "9.000000" }],
      discrepancyNote: "one bag burst in transit",
    });
    expect(result.discrepancyNote).toBe("one bag burst in transit");
  });

  it("fails dispatch when the in-transit holding point is missing", async () => {
    const noArea = await setup();
    noArea.store.storageAreas.delete(noArea.fixture.transitStorageAreaId);
    const areaTransfer = await request(noArea);
    await approve(noArea, areaTransfer);
    await expect(dispatch(noArea, areaTransfer)).rejects.toThrow(/in-transit storage area/);

    const noLocation = await setup();
    noLocation.store.locations.delete(noLocation.fixture.transitLocationId);
    const locationTransfer = await request(noLocation);
    await approve(noLocation, locationTransfer);
    await expect(dispatch(noLocation, locationTransfer)).rejects.toThrow(
      /virtual transit location/,
    );
  });

  it("enforces the workflow state machine", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);

    await expect(dispatch(context, transferId)).rejects.toThrow(
      /cannot dispatch a transfer in status requested/,
    );
    await approve(context, transferId);
    await expect(
      approveStockTransfer(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        transferId,
      }),
    ).rejects.toThrow(/cannot approve a transfer in status approved/);

    await dispatch(context, transferId);
    await expect(
      cancelStockTransfer(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        transferId,
      }),
    ).rejects.toThrow(/cannot cancel a transfer in status dispatched/);

    // Receiving is only legal from `dispatched`: a freshly approved transfer
    // has not moved stock yet.
    const approvedOnly = await request(context);
    await approve(context, approvedOnly);
    await expect(
      receiveStockTransfer(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        transferId: approvedOnly,
        received: [{ itemId: fixture.itemId, quantity: "1.000000" }],
      }),
    ).rejects.toThrow(/cannot receive a transfer in status approved/);
  });

  it("cancels a transfer that has not moved stock", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);

    await cancelStockTransfer(store, {
      organizationId: fixture.organizationId,
      actorId: "actor",
      transferId,
      reasonCode: "requested by mistake",
    });
    const transfer = await store.findStockTransfer({
      organizationId: fixture.organizationId,
      transferId,
    });
    expect(transfer?.status).toBe("cancelled");
  });

  it("rejects a transfer that shares an endpoint or uses the transit point", async () => {
    const context = await setup();
    const { store, fixture } = context;

    await expect(
      requestStockTransfer(store, {
        ...requestInput(fixture),
        toStorageAreaId: fixture.storageAreaId,
      }),
    ).rejects.toThrow(/same storage area/);

    await expect(
      requestStockTransfer(store, {
        ...requestInput(fixture),
        toLocationId: fixture.transitLocationId,
        toStorageAreaId: fixture.transitStorageAreaId,
      }),
    ).rejects.toThrow(/must not end at the virtual transit location/);
  });

  it("rejects a duplicate item/lot line in one dispatch", async () => {
    const context = await setup();
    const transferId = await request(context);
    await approve(context, transferId);
    await expect(
      dispatchStockTransfer(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: "actor",
        transferId,
        lines: [
          { itemId: context.fixture.itemId, quantity: "1.000000" },
          { itemId: context.fixture.itemId, quantity: "2.000000" },
        ],
      }),
    ).rejects.toThrow(/duplicates an earlier item\/lot line/);
  });

  it("rejects a receipt for an item that was not dispatched", async () => {
    const context = await setup();
    const { store, fixture } = context;
    const transferId = await request(context);
    await approve(context, transferId);
    await dispatch(context, transferId);

    store.items.set("item-other", {
      id: "item-other",
      organizationId: fixture.organizationId,
      code: "OTHER",
      name: "Other item",
      baseUnitId: fixture.unitId,
      inventoryPolicy: "stocked",
      lotTracked: false,
    });
    await expect(
      receiveStockTransfer(store, {
        organizationId: fixture.organizationId,
        actorId: "actor",
        transferId,
        received: [{ itemId: "item-other", quantity: "1.000000" }],
      }),
    ).rejects.toThrow(/was not dispatched/);
  });

  it("blocks a dispatch that would drive stock negative unless overridden", async () => {
    const context = await setup();
    const transferId = await request(context);
    await approve(context, transferId);

    await expect(dispatch(context, transferId, "200.000000")).rejects.toThrow(DomainError);
    await expect(
      dispatchStockTransfer(context.store, {
        organizationId: context.fixture.organizationId,
        actorId: "actor",
        transferId,
        lines: [{ itemId: context.fixture.itemId, quantity: "200.000000" }],
        allowNegativeOverride: true,
      }),
    ).rejects.toThrow(/requires a reasonCode/);
  });
});

describe("transfers reads", () => {
  it("pages transfers newest-first and filters by status", async () => {
    const context = await setup();
    const first = await request(context);
    const second = await request(context);
    await approve(context, second);

    const page = await listStockTransfers(context.store, {
      organizationId: context.fixture.organizationId,
      limit: 1,
    });
    expect(page.transfers).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.limit).toBe(1);

    const requested = await listStockTransfers(context.store, {
      organizationId: context.fixture.organizationId,
      status: "requested",
    });
    expect(requested.transfers.map((row) => row.transfer.id)).toEqual([first]);

    const approved = await listStockTransfers(context.store, {
      organizationId: context.fixture.organizationId,
      status: "approved",
    });
    expect(approved.transfers.map((row) => row.transfer.id)).toEqual([second]);
  });

  it("returns undefined for an unknown transfer and rejects a bad page size", async () => {
    const context = await setup();
    await expect(
      getStockTransfer(context.store, {
        organizationId: context.fixture.organizationId,
        transferId: "missing",
      }),
    ).resolves.toBeUndefined();
    await expect(
      listStockTransfers(context.store, {
        organizationId: context.fixture.organizationId,
        limit: 0,
      }),
    ).rejects.toThrow(/limit must be an integer/);
  });
});

describe("summarizeTransferMovements", () => {
  function movement(overrides: Partial<TransferMovementRecord>): TransferMovementRecord {
    return {
      id: "movement",
      organizationId: "org",
      locationId: "loc",
      storageAreaId: "area",
      itemId: "item",
      lotId: null,
      movementType: "transfer_dispatch",
      quantityDelta: "0.000000",
      unitId: "unit",
      unitCost: null,
      valueDelta: "0.0000",
      currency: "NOK",
      sourceType: "transfer",
      sourceId: "transfer",
      transferId: "transfer",
      reversalOfId: null,
      occurredAt: "2026-09-01T08:00:00.000Z",
      postedAt: "2026-09-01T08:00:00.000Z",
      postedBy: "actor",
      reasonCode: null,
      idempotencyKey: null,
      ...overrides,
    };
  }

  it("nets the two legs of a line and ignores revaluation movements", () => {
    const summary = summarizeTransferMovements([
      movement({ id: "d-out", quantityDelta: "-10.000000" }),
      movement({ id: "d-in", quantityDelta: "10.000000", unitCost: "0.2500" }),
      movement({ id: "r-out", movementType: "transfer_receipt", quantityDelta: "-10.000000" }),
      movement({ id: "r-in", movementType: "transfer_receipt", quantityDelta: "10.000000" }),
      movement({ id: "rev", movementType: "revaluation", quantityDelta: "0.000000" }),
    ]);
    expect(summary.dispatchedQuantity).toBe("10.000000");
    expect(summary.receivedQuantity).toBe("10.000000");
    expect(summary.hasDiscrepancy).toBe(false);
    expect(summary.lines[0]?.unitCost).toBe("0.2500");
  });

  it("flags a received-only line as a discrepancy", () => {
    const summary = summarizeTransferMovements([
      movement({ movementType: "transfer_receipt", quantityDelta: "3.000000" }),
    ]);
    expect(summary.lines[0]).toMatchObject({
      dispatchedQuantity: "0.000000",
      receivedQuantity: "3.000000",
      hasDiscrepancy: true,
    });
  });
});
