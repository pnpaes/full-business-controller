import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  WasteEventRecord,
  WasteProductVariantRecord,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseRecordWasteBody,
  parseWasteQuery,
  toWasteEventRows,
  type WasteRefs,
} from "./waste-rows";

const ORG = "1448a476-32f2-426f-b153-11a851011e48";
const OTHER_ORG = "00000000-0000-4000-8000-000000000000";
const ITEM = "3bece9e8-ee3d-41e5-b340-dacba03c7855";
const VARIANT = "6f85c3c4-1313-4794-9172-552a0faa0b88";
const UNIT = "4d3d9ae8-4113-406e-9804-9175ea27e777";
const LOCATION = "9fe2b5a0-c643-459f-85c3-f3c64f3932ce";
const AREA = "943c94b6-83de-4688-80c6-4dbd9e13520a";

describe("parseWasteQuery", () => {
  it("defaults the page and accepts no filters", () => {
    expect(parseWasteQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("accepts a stage, UUID filters, a window and paging", () => {
    const result = parseWasteQuery(
      new URLSearchParams({
        locationId: LOCATION,
        itemId: ITEM,
        stage: "storage_expiry",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
        limit: "10",
        offset: "20",
      }),
    );
    expect(result).toEqual({
      ok: true,
      query: {
        locationId: LOCATION,
        itemId: ITEM,
        stage: "storage_expiry",
        occurredFrom: "2026-01-01T00:00:00.000Z",
        occurredTo: "2026-02-01T00:00:00.000Z",
        limit: 10,
        offset: 20,
      },
    });
  });

  it("rejects a malformed uuid, an unknown stage, a bad instant and out-of-range paging", () => {
    expect(parseWasteQuery(new URLSearchParams({ itemId: "nope" }))).toEqual({ ok: false });
    expect(parseWasteQuery(new URLSearchParams({ stage: "burned" }))).toEqual({ ok: false });
    expect(parseWasteQuery(new URLSearchParams({ from: "2026-01-01" }))).toEqual({ ok: false });
    expect(parseWasteQuery(new URLSearchParams({ limit: "0" }))).toEqual({ ok: false });
    expect(parseWasteQuery(new URLSearchParams({ limit: "201" }))).toEqual({ ok: false });
    expect(parseWasteQuery(new URLSearchParams({ offset: "-1" }))).toEqual({ ok: false });
  });
});

describe("parseRecordWasteBody", () => {
  const base = {
    locationId: LOCATION,
    storageAreaId: AREA,
    quantity: "2.500000",
    stage: "preparation",
    reasonCode: "preparation",
  };

  it("accepts an item-only body", () => {
    const parsed = parseRecordWasteBody({ ...base, itemId: ITEM });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input).toMatchObject({
        itemId: ITEM,
        productVariantId: null,
        quantity: "2.500000",
        stage: "preparation",
        occurredAt: null,
        allowNegativeOverride: false,
      });
    }
  });

  it("accepts a variant-only body", () => {
    const parsed = parseRecordWasteBody({ ...base, productVariantId: VARIANT });
    expect(parsed.ok).toBe(true);
  });

  it("rejects neither or both of item and variant", () => {
    expect(parseRecordWasteBody({ ...base })).toEqual({ ok: false });
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, productVariantId: VARIANT })).toEqual({
      ok: false,
    });
  });

  it("rejects a bad stage, a blank reason, a non-positive quantity and a missing location", () => {
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, stage: "burned" })).toEqual({ ok: false });
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, reasonCode: "   " })).toEqual({
      ok: false,
    });
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, quantity: "0" })).toEqual({ ok: false });
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, locationId: "not-a-uuid" })).toEqual({
      ok: false,
    });
  });

  it("rejects an idempotency key containing ':'", () => {
    expect(parseRecordWasteBody({ ...base, itemId: ITEM, idempotencyKey: "a:b" })).toEqual({
      ok: false,
    });
  });
});

function event(overrides: Partial<WasteEventRecord> = {}): WasteEventRecord {
  return {
    id: "waste-1",
    organizationId: ORG,
    locationId: LOCATION,
    storageAreaId: AREA,
    itemId: ITEM,
    productVariantId: null,
    productionBatchId: null,
    quantity: "2.500000",
    unitId: UNIT,
    stage: "storage_expiry",
    reasonCode: "storage_expiry",
    valueMethod: "moving_average",
    value: "1.2500",
    currency: "NOK",
    occurredAt: "2026-01-02T10:00:00.000Z",
    actorId: "actor",
    photoFileId: null,
    correctiveAction: null,
    snapshotId: null,
    ...overrides,
  };
}

function refs(overrides: Partial<WasteRefs> = {}): WasteRefs {
  const item: InventoryItemRecord = {
    id: ITEM,
    organizationId: ORG,
    code: "DEMO_ESPRESSO_BEANS",
    name: "Demo Espresso Beans",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: false,
  };
  const variant: WasteProductVariantRecord = {
    id: VARIANT,
    organizationId: ORG,
    code: "DEMO_LATTE",
    name: "Demo Latte",
    finishedGoodItemId: ITEM,
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
  return {
    items: new Map([[ITEM, item]]),
    productVariants: new Map([[VARIANT, variant]]),
    units: new Map([[UNIT, unit]]),
    locations: new Map([[LOCATION, location]]),
    storageAreas: new Map([[AREA, area]]),
    ...overrides,
  };
}

describe("toWasteEventRows", () => {
  it("enriches an item event with its labels", () => {
    const [row] = toWasteEventRows(ORG, [event()], refs());
    expect(row).toMatchObject({
      id: "waste-1",
      itemLabel: "DEMO_ESPRESSO_BEANS · Demo Espresso Beans",
      variantLabel: null,
      unitCode: "g",
      locationCode: "DEMO_CAFE",
      storageAreaCode: "DEMO_DRY",
      value: "1.2500",
      currency: "NOK",
    });
  });

  it("labels a variant event from the variant reference", () => {
    const [row] = toWasteEventRows(
      ORG,
      [event({ itemId: null, productVariantId: VARIANT })],
      refs(),
    );
    expect(row?.variantLabel).toBe("DEMO_LATTE · Demo Latte");
    expect(row?.itemLabel).toBeNull();
  });

  it("drops a foreign organization's event and org-checks its references", () => {
    expect(toWasteEventRows(ORG, [event({ organizationId: OTHER_ORG })], refs())).toEqual([]);

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
    const [row] = toWasteEventRows(ORG, [event()], foreign);
    expect(row?.locationCode).toBeNull();
  });
});
