import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockLotRecord,
  StockMovementRecord,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  manualSourceType,
  parseMovementQuery,
  parsePostMovementBody,
  parseReverseBody,
  toMovementRows,
  type MovementRefs,
} from "./movement-rows";

const ORG = "1448a476-32f2-426f-b153-11a851011e48";
const OTHER_ORG = "00000000-0000-4000-8000-000000000000";
const ITEM = "3bece9e8-ee3d-41e5-b340-dacba03c7855";
const UNIT = "4d3d9ae8-4113-406e-9804-9175ea27e777";
const LOCATION = "9fe2b5a0-c643-459f-85c3-f3c64f3932ce";
const AREA = "943c94b6-83de-4688-80c6-4dbd9e13520a";
const LOT = "6f85c3c4-1313-4794-9172-552a0faa0b88";
const MOVEMENT = "d1e0b5c0-3a1a-4f4a-9d0e-2f0b7c6a5e44";

function movement(overrides: Partial<StockMovementRecord> = {}): StockMovementRecord {
  return {
    id: MOVEMENT,
    organizationId: ORG,
    locationId: LOCATION,
    storageAreaId: AREA,
    itemId: ITEM,
    lotId: null,
    movementType: "waste",
    quantityDelta: "-1.000000",
    unitId: UNIT,
    unitCost: "5.0000",
    valueDelta: "-5.0000",
    currency: "NOK",
    sourceType: "waste_event",
    sourceId: "src",
    reversalOfId: null,
    occurredAt: "2026-09-01T10:00:00.000Z",
    postedAt: "2026-09-01T10:00:01.000Z",
    postedBy: "actor",
    reasonCode: "spoiled",
    idempotencyKey: null,
    ...overrides,
  };
}

function refs(overrides: Partial<MovementRefs> = {}): MovementRefs {
  const item: InventoryItemRecord = {
    id: ITEM,
    organizationId: ORG,
    code: "ESPRESSO",
    name: "Espresso beans",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: false,
  };
  const unit: InventoryUnitRecord = { id: UNIT, organizationId: ORG, code: "g", dimension: "mass" };
  const location: InventoryLocationRecord = {
    id: LOCATION,
    organizationId: ORG,
    code: "OSLO",
    name: "Oslo",
    kind: "operating",
  };
  const area: InventoryStorageAreaRecord = {
    id: AREA,
    organizationId: ORG,
    locationId: LOCATION,
    code: "DRY",
    name: "Dry store",
    kind: "dry_store",
    isTransit: false,
  };
  const lot: StockLotRecord = {
    id: LOT,
    organizationId: ORG,
    itemId: ITEM,
    locationId: LOCATION,
    lotNumber: "L1",
    expiryDate: null,
    openedDate: null,
    receivedAt: null,
    sourceMovementId: null,
  };
  return {
    items: new Map([[ITEM, item]]),
    units: new Map([[UNIT, unit]]),
    locations: new Map([[LOCATION, location]]),
    storageAreas: new Map([[AREA, area]]),
    lots: new Map([[LOT, lot]]),
    ...overrides,
  };
}

describe("parseMovementQuery", () => {
  it("defaults paging and accepts no filters", () => {
    expect(parseMovementQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("passes through filters and the no-lot selector", () => {
    const result = parseMovementQuery(
      new URLSearchParams({
        itemId: ITEM,
        locationId: LOCATION,
        storageAreaId: AREA,
        lotId: "none",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
        limit: "10",
        offset: "20",
      }),
    );
    expect(result).toEqual({
      ok: true,
      query: {
        itemId: ITEM,
        locationId: LOCATION,
        storageAreaId: AREA,
        lotId: null,
        occurredFrom: "2026-01-01T00:00:00.000Z",
        occurredTo: "2026-02-01T00:00:00.000Z",
        limit: 10,
        offset: 20,
      },
    });
  });

  it("rejects a malformed UUID, lot selector, instant and paging bound", () => {
    expect(parseMovementQuery(new URLSearchParams({ itemId: "nope" }))).toEqual({ ok: false });
    expect(parseMovementQuery(new URLSearchParams({ lotId: "nope" }))).toEqual({ ok: false });
    expect(parseMovementQuery(new URLSearchParams({ from: "2026-01-01" }))).toEqual({ ok: false });
    expect(parseMovementQuery(new URLSearchParams({ limit: "0" }))).toEqual({ ok: false });
    expect(parseMovementQuery(new URLSearchParams({ limit: "201" }))).toEqual({ ok: false });
    expect(parseMovementQuery(new URLSearchParams({ offset: "-1" }))).toEqual({ ok: false });
  });
});

describe("parsePostMovementBody", () => {
  const base = {
    itemId: ITEM,
    locationId: LOCATION,
    storageAreaId: AREA,
    movementType: "waste",
    quantityDelta: "-2.000000",
    reasonCode: "spoiled",
  };

  it("maps a valid waste body, deriving the source type", () => {
    const parsed = parsePostMovementBody(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input).toEqual({
      itemId: ITEM,
      locationId: LOCATION,
      storageAreaId: AREA,
      movementType: "waste",
      sourceType: "waste_event",
      quantityDelta: "-2.000000",
      unitCost: null,
      occurredAt: null,
      lotId: null,
      reasonCode: "spoiled",
      idempotencyKey: null,
      allowNegativeOverride: false,
    });
  });

  it("maps a positive adjustment to the adjustment source", () => {
    const parsed = parsePostMovementBody({
      ...base,
      movementType: "correction",
      quantityDelta: "3.500000",
      unitCost: "12.3400",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.sourceType).toBe("adjustment");
    expect(parsed.input.unitCost).toBe("12.3400");
  });

  it("rejects zero, unparseable decimals, waste that adds stock and a positive cost", () => {
    expect(parsePostMovementBody({ ...base, quantityDelta: "0" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, quantityDelta: "abc" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, quantityDelta: "1.000000" }).ok).toBe(false);
    expect(
      parsePostMovementBody({
        ...base,
        movementType: "correction",
        quantityDelta: "1.000000",
        unitCost: "-1.0000",
      }).ok,
    ).toBe(false);
  });

  it("requires a reason, a known type and well-formed ids", () => {
    expect(parsePostMovementBody({ ...base, reasonCode: "  " }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, reasonCode: undefined }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, movementType: "receipt" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, itemId: "nope" }).ok).toBe(false);
    expect(parsePostMovementBody(undefined).ok).toBe(false);
  });

  it("validates the instant, lot and idempotency key", () => {
    expect(parsePostMovementBody({ ...base, occurredAt: "2026-01-01" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, occurredAt: "2026-01-01T00:00:00.000Z" }).ok).toBe(
      true,
    );
    expect(parsePostMovementBody({ ...base, lotId: "nope" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, idempotencyKey: "a:b" }).ok).toBe(false);
    expect(parsePostMovementBody({ ...base, allowNegativeOverride: "yes" }).ok).toBe(false);
  });
});

describe("parseReverseBody", () => {
  it("requires a non-blank reason and defaults the override", () => {
    expect(parseReverseBody({ reasonCode: "wrong entry" })).toEqual({
      ok: true,
      reasonCode: "wrong entry",
      allowNegativeOverride: false,
    });
    expect(parseReverseBody({ reasonCode: "" })).toEqual({ ok: false });
    expect(parseReverseBody({})).toEqual({ ok: false });
    expect(parseReverseBody(undefined)).toEqual({ ok: false });
  });
});

describe("toMovementRows", () => {
  it("enriches a movement with the resolvable display fields", () => {
    const [row] = toMovementRows(ORG, [movement({ lotId: LOT })], refs(), new Set([MOVEMENT]));
    expect(row).toMatchObject({
      id: MOVEMENT,
      itemCode: "ESPRESSO",
      itemName: "Espresso beans",
      locationCode: "OSLO",
      storageAreaCode: "DRY",
      storageAreaName: "Dry store",
      lotNumber: "L1",
      unitCode: "g",
      quantityDelta: "-1.000000",
      reversed: true,
    });
  });

  it("leaves unknown lookups null and drops another organization's rows", () => {
    const empty: MovementRefs = {
      items: new Map(),
      units: new Map(),
      locations: new Map(),
      storageAreas: new Map(),
      lots: new Map(),
    };
    const [row] = toMovementRows(ORG, [movement()], empty);
    expect(row?.itemCode).toBeNull();
    expect(row?.unitCode).toBeNull();
    expect(row?.locationCode).toBeNull();
    expect(row?.reversed).toBe(false);
    expect(toMovementRows(ORG, [movement({ organizationId: OTHER_ORG })], refs())).toEqual([]);
  });
});

describe("manualSourceType", () => {
  it("maps waste to waste_event and adjustments to adjustment", () => {
    expect(manualSourceType("waste")).toBe("waste_event");
    expect(manualSourceType("count_adjustment")).toBe("adjustment");
    expect(manualSourceType("correction")).toBe("adjustment");
  });
});
