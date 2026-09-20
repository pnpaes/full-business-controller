import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  TransferDetail,
  TransferMovementRecord,
  TransferSummary,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseCancelTransferBody,
  parseDispatchTransferBody,
  parseReceiveTransferBody,
  parseRequestTransferBody,
  parseTransferListQuery,
  toTransferDetailResponse,
  toTransferLineRows,
  toTransferMovementRows,
  toTransferRows,
  type TransferRefs,
} from "./transfer-rows";

const ORG = "1448a476-32f2-426f-b153-11a851011e48";
const OTHER_ORG = "00000000-0000-4000-8000-000000000000";
const TRANSFER = "3bece9e8-ee3d-41e5-b340-dacba03c7855";
const ITEM = "4d3d9ae8-4113-406e-9804-9175ea27e777";
const UNIT = "9fe2b5a0-c643-459f-85c3-f3c64f3932ce";
const FROM_LOCATION = "943c94b6-83de-4688-80c6-4dbd9e13520a";
const TO_LOCATION = "6f85c3c4-1313-4794-9172-552a0faa0b88";
const FROM_AREA = "5a85c3c4-1313-4794-9172-552a0faa0b11";
const TO_AREA = "7b85c3c4-1313-4794-9172-552a0faa0b22";

function refs(overrides: Partial<TransferRefs> = {}): TransferRefs {
  const item: InventoryItemRecord = {
    id: ITEM,
    organizationId: ORG,
    code: "DEMO_FLOUR",
    name: "Demo Flour",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: false,
  };
  const unit: InventoryUnitRecord = {
    id: UNIT,
    organizationId: ORG,
    code: "g",
    dimension: "mass",
  };
  const fromLocation: InventoryLocationRecord = {
    id: FROM_LOCATION,
    organizationId: ORG,
    code: "MAIN",
    name: "Main",
    kind: "operating",
  };
  const toLocation: InventoryLocationRecord = {
    id: TO_LOCATION,
    organizationId: ORG,
    code: "ANNEX",
    name: "Annex",
    kind: "operating",
  };
  const fromArea: InventoryStorageAreaRecord = {
    id: FROM_AREA,
    organizationId: ORG,
    locationId: FROM_LOCATION,
    code: "DRY",
    name: "Dry store",
    kind: "dry_store",
    isTransit: false,
  };
  const toArea: InventoryStorageAreaRecord = {
    id: TO_AREA,
    organizationId: ORG,
    locationId: TO_LOCATION,
    code: "DRY2",
    name: "Dry store 2",
    kind: "dry_store",
    isTransit: false,
  };
  return {
    locations: new Map([
      [FROM_LOCATION, fromLocation],
      [TO_LOCATION, toLocation],
    ]),
    storageAreas: new Map([
      [FROM_AREA, fromArea],
      [TO_AREA, toArea],
    ]),
    items: new Map([[ITEM, item]]),
    units: new Map([[UNIT, unit]]),
    ...overrides,
  };
}

function summary(overrides: Partial<TransferSummary> = {}): TransferSummary {
  return {
    transfer: {
      id: TRANSFER,
      organizationId: ORG,
      fromLocationId: FROM_LOCATION,
      fromStorageAreaId: FROM_AREA,
      toLocationId: TO_LOCATION,
      toStorageAreaId: TO_AREA,
      status: "received",
      dispatchedAt: "2026-09-02T08:00:00.000Z",
      receivedAt: "2026-09-03T08:00:00.000Z",
      dispatchMovementId: "m1",
      receiptMovementId: "m3",
      discrepancyNote: null,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-03T08:00:00.000Z",
    },
    lines: [],
    dispatchedQuantity: "10.000000",
    receivedQuantity: "10.000000",
    hasDiscrepancy: false,
    ...overrides,
  };
}

function movement(overrides: Partial<TransferMovementRecord> = {}): TransferMovementRecord {
  return {
    id: "m1",
    organizationId: ORG,
    locationId: FROM_LOCATION,
    storageAreaId: FROM_AREA,
    itemId: ITEM,
    lotId: null,
    movementType: "transfer_dispatch",
    quantityDelta: "-10.000000",
    unitId: UNIT,
    unitCost: "0.2500",
    valueDelta: "-2.5000",
    currency: "NOK",
    sourceType: "transfer",
    sourceId: TRANSFER,
    transferId: TRANSFER,
    reversalOfId: null,
    occurredAt: "2026-09-02T08:00:00.000Z",
    postedAt: "2026-09-02T08:00:00.000Z",
    postedBy: "actor",
    reasonCode: null,
    idempotencyKey: null,
    ...overrides,
  };
}

describe("parseTransferListQuery", () => {
  it("accepts no filters", () => {
    expect(parseTransferListQuery(new URLSearchParams())).toEqual({ ok: true, query: {} });
  });

  it("accepts a status, UUID filters and paging", () => {
    const result = parseTransferListQuery(
      new URLSearchParams({
        status: "dispatched",
        fromLocationId: FROM_LOCATION,
        toLocationId: TO_LOCATION,
        limit: "10",
        offset: "20",
      }),
    );
    expect(result).toEqual({
      ok: true,
      query: {
        status: "dispatched",
        fromLocationId: FROM_LOCATION,
        toLocationId: TO_LOCATION,
        limit: 10,
        offset: 20,
      },
    });
  });

  it("rejects an unknown status, a malformed UUID and bad paging", () => {
    expect(parseTransferListQuery(new URLSearchParams({ status: "nope" })).ok).toBe(false);
    expect(parseTransferListQuery(new URLSearchParams({ fromLocationId: "x" })).ok).toBe(false);
    expect(parseTransferListQuery(new URLSearchParams({ limit: "-1" })).ok).toBe(false);
    expect(parseTransferListQuery(new URLSearchParams({ offset: "a" })).ok).toBe(false);
  });
});

describe("request/dispatch/receive/cancel bodies", () => {
  it("accepts a well-formed request body and rejects a missing id", () => {
    const body = {
      fromLocationId: FROM_LOCATION,
      fromStorageAreaId: FROM_AREA,
      toLocationId: TO_LOCATION,
      toStorageAreaId: TO_AREA,
    };
    expect(parseRequestTransferBody(body)).toEqual({ ok: true, input: body });
    expect(parseRequestTransferBody({ ...body, toLocationId: "nope" }).ok).toBe(false);
    expect(parseRequestTransferBody({}).ok).toBe(false);
  });

  it("accepts dispatch lines and normalizes an empty reason to null", () => {
    const parsed = parseDispatchTransferBody({
      lines: [{ itemId: ITEM, quantity: "5.000000" }],
      reasonCode: "  ",
      allowNegativeOverride: true,
    });
    expect(parsed).toEqual({
      ok: true,
      input: {
        lines: [{ itemId: ITEM, quantity: "5.000000", lotId: null }],
        reasonCode: null,
        allowNegativeOverride: true,
      },
    });
    expect(parseDispatchTransferBody({ lines: [] }).ok).toBe(false);
    expect(parseDispatchTransferBody({ lines: [{ itemId: ITEM, quantity: "" }] }).ok).toBe(false);
    expect(
      parseDispatchTransferBody({ lines: [{ itemId: ITEM, quantity: "1", lotId: "x" }] }).ok,
    ).toBe(false);
    expect(
      parseDispatchTransferBody({
        lines: [{ itemId: ITEM, quantity: "1" }],
        allowNegativeOverride: "yes",
      }).ok,
    ).toBe(false);
  });

  it("accepts a receive body and treats an empty note as absent", () => {
    const parsed = parseReceiveTransferBody({
      received: [{ itemId: ITEM, quantity: "5.000000" }],
      discrepancyNote: "",
    });
    expect(parsed).toEqual({
      ok: true,
      input: {
        received: [{ itemId: ITEM, quantity: "5.000000", lotId: null }],
        discrepancyNote: null,
      },
    });
    expect(parseReceiveTransferBody({ received: [] })).toEqual({
      ok: true,
      input: { received: [], discrepancyNote: null },
    });
  });

  it("accepts an absent cancel body", () => {
    expect(parseCancelTransferBody(undefined)).toEqual({ ok: true, reasonCode: null });
    expect(parseCancelTransferBody({ reasonCode: "duplicate" })).toEqual({
      ok: true,
      reasonCode: "duplicate",
    });
    expect(parseCancelTransferBody({ reasonCode: 7 }).ok).toBe(false);
  });
});

describe("transfer row mapping", () => {
  it("enriches a summary with the endpoint labels", () => {
    const [row] = toTransferRows(ORG, [summary()], refs());
    expect(row).toMatchObject({
      id: TRANSFER,
      status: "received",
      fromLocationLabel: "MAIN",
      fromStorageAreaLabel: "DRY · Dry store",
      toLocationLabel: "ANNEX",
      toStorageAreaLabel: "DRY2 · Dry store 2",
      dispatchedQuantity: "10.000000",
      receivedQuantity: "10.000000",
      hasDiscrepancy: false,
    });
  });

  it("drops a transfer from another organization", () => {
    const foreign = summary({
      transfer: { ...summary().transfer, organizationId: OTHER_ORG },
    });
    expect(toTransferRows(ORG, [foreign], refs())).toEqual([]);
  });

  it("resolves the item code and unit for a line", () => {
    const [line] = toTransferLineRows(
      ORG,
      [
        {
          itemId: ITEM,
          lotId: null,
          dispatchedQuantity: "10.000000",
          receivedQuantity: "8.000000",
          unitCost: "0.2500",
          hasDiscrepancy: true,
        },
      ],
      refs(),
    );
    expect(line).toMatchObject({
      itemCode: "DEMO_FLOUR",
      itemName: "Demo Flour",
      unitCode: "g",
      hasDiscrepancy: true,
    });
  });

  it("maps movements with their location/area/item codes", () => {
    const [row] = toTransferMovementRows(ORG, [movement()], refs());
    expect(row).toMatchObject({
      movementType: "transfer_dispatch",
      locationCode: "MAIN",
      storageAreaCode: "DRY",
      itemCode: "DEMO_FLOUR",
      quantityDelta: "-10.000000",
      unitCost: "0.2500",
    });
  });

  it("assembles a detail response", () => {
    const detail: TransferDetail = {
      ...summary(),
      movements: [movement()],
      lines: [
        {
          itemId: ITEM,
          lotId: null,
          dispatchedQuantity: "10.000000",
          receivedQuantity: "10.000000",
          unitCost: "0.2500",
          hasDiscrepancy: false,
        },
      ],
    };
    const response = toTransferDetailResponse(ORG, detail, refs());
    expect(response.transfer.id).toBe(TRANSFER);
    expect(response.lines).toHaveLength(1);
    expect(response.movements).toHaveLength(1);
  });
});
