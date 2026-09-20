import { describe, expect, it } from "vitest";

import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockBalanceAsOfEntry,
  StockLotRecord,
} from "@aquarela/application";

import { parseBalanceQuery, toBalanceRows, type BalanceRefs } from "./balance-rows";

const ORG = "1448a476-32f2-426f-b153-11a851011e48";
const OTHER_ORG = "00000000-0000-4000-8000-000000000000";
const ITEM = "3bece9e8-ee3d-41e5-b340-dacba03c7855";
const UNIT = "4d3d9ae8-4113-406e-9804-9175ea27e777";
const LOCATION = "9fe2b5a0-c643-459f-85c3-f3c64f3932ce";
const AREA = "943c94b6-83de-4688-80c6-4dbd9e13520a";
const LOT = "6f85c3c4-1313-4794-9172-552a0faa0b88";

function balance(overrides: Partial<StockBalanceAsOfEntry> = {}): StockBalanceAsOfEntry {
  return {
    organizationId: ORG,
    itemId: ITEM,
    locationId: LOCATION,
    storageAreaId: AREA,
    lotId: null,
    quantityOnHand: "850.000000",
    valueOnHand: "212.5000",
    avgUnitCost: "0.2500",
    ...overrides,
  };
}

function refs(overrides: Partial<BalanceRefs> = {}): BalanceRefs {
  const item: InventoryItemRecord = {
    id: ITEM,
    organizationId: ORG,
    code: "DEMO_ESPRESSO_BEANS",
    name: "Demo Espresso Beans",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: false,
  };
  const unit: InventoryUnitRecord = { id: UNIT, organizationId: ORG, code: "g", dimension: "mass" };
  const location: InventoryLocationRecord = {
    id: LOCATION,
    organizationId: ORG,
    code: "DEMO_CAFE",
    name: "Demo Café",
    kind: "operating",
  };
  const area: InventoryStorageAreaRecord = {
    id: AREA,
    organizationId: ORG,
    locationId: LOCATION,
    code: "DEMO_DRY",
    name: "Demo Dry Store",
    kind: "dry_store",
    isTransit: false,
  };
  const lot: StockLotRecord = {
    id: LOT,
    organizationId: ORG,
    itemId: ITEM,
    locationId: LOCATION,
    lotNumber: "LOT-1",
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

describe("parseBalanceQuery", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("defaults asOf to now and accepts no filters", () => {
    expect(parseBalanceQuery(new URLSearchParams(), now)).toEqual({
      ok: true,
      query: { asOf: "2026-09-20T12:00:00.000Z" },
    });
  });

  it("passes through an explicit instant and UUID filters", () => {
    const result = parseBalanceQuery(
      new URLSearchParams({ asOf: "2026-09-01T08:00:00.000Z", itemId: ITEM, locationId: LOCATION }),
      now,
    );
    expect(result).toEqual({
      ok: true,
      query: { asOf: "2026-09-01T08:00:00.000Z", itemId: ITEM, locationId: LOCATION },
    });
  });

  it("rejects a blank asOf", () => {
    expect(parseBalanceQuery(new URLSearchParams({ asOf: "  " }), now)).toEqual({ ok: false });
  });

  it("rejects a malformed itemId", () => {
    expect(parseBalanceQuery(new URLSearchParams({ itemId: "not-a-uuid" }), now)).toEqual({
      ok: false,
    });
  });

  it("ignores unrelated parameters", () => {
    expect(parseBalanceQuery(new URLSearchParams({ page: "2" }), now)).toEqual({
      ok: true,
      query: { asOf: "2026-09-20T12:00:00.000Z" },
    });
  });
});

describe("toBalanceRows", () => {
  it("enriches a balance with the resolvable identifiers", () => {
    const [row] = toBalanceRows(ORG, [balance()], refs());
    expect(row).toEqual({
      itemId: ITEM,
      itemCode: "DEMO_ESPRESSO_BEANS",
      itemName: "Demo Espresso Beans",
      itemBaseUnitId: UNIT,
      itemBaseUnitCode: "g",
      locationId: LOCATION,
      locationCode: "DEMO_CAFE",
      storageAreaId: AREA,
      storageAreaCode: "DEMO_DRY",
      storageAreaName: "Demo Dry Store",
      lotId: null,
      lotNumber: null,
      quantityOnHand: "850.000000",
      valueOnHand: "212.5000",
      avgUnitCost: "0.2500",
    });
  });

  it("resolves a lot number when the balance carries a lot", () => {
    const [row] = toBalanceRows(ORG, [balance({ lotId: LOT })], refs());
    expect(row?.lotId).toBe(LOT);
    expect(row?.lotNumber).toBe("LOT-1");
  });

  it("leaves unknown lookups null", () => {
    const empty: BalanceRefs = {
      items: new Map(),
      units: new Map(),
      locations: new Map(),
      storageAreas: new Map(),
      lots: new Map(),
    };
    const [row] = toBalanceRows(ORG, [balance()], empty);
    expect(row?.itemCode).toBeNull();
    expect(row?.itemName).toBeNull();
    expect(row?.itemBaseUnitCode).toBeNull();
    expect(row?.locationCode).toBeNull();
    expect(row?.storageAreaName).toBeNull();
  });

  it("drops a balance from another organization", () => {
    expect(toBalanceRows(ORG, [balance({ organizationId: OTHER_ORG })], refs())).toEqual([]);
  });

  it("ignores a reference record owned by another organization", () => {
    const foreign = refs({
      locations: new Map([
        [
          LOCATION,
          {
            id: LOCATION,
            organizationId: OTHER_ORG,
            code: "LEAKED",
            name: "Leaked",
            kind: "operating",
          },
        ],
      ]),
    });
    const [row] = toBalanceRows(ORG, [balance()], foreign);
    expect(row?.locationCode).toBeNull();
  });
});
