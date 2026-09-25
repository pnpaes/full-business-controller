import type {
  GoodsReceiptLineRecord,
  GoodsReceiptSummaryRecord,
  ReceivingItem,
  ReceivingLocationRecord,
  ReceivingSupplierOption,
  ReceivingUnit,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseReceiptListQuery,
  toReceiptLineRows,
  toReceiptRows,
  type ReceiptRefs,
} from "./receipt-http";

const ORG = "org-1";
const OTHER = "org-2";

function summary(overrides: Partial<GoodsReceiptSummaryRecord> = {}): GoodsReceiptSummaryRecord {
  return {
    id: "receipt-1",
    organizationId: ORG,
    supplierId: "sup-1",
    storeName: null,
    locationId: "loc-1",
    purchaseOrderId: null,
    deliveryRef: null,
    receivedAt: "2026-09-19T10:00:00.000Z",
    status: "accepted",
    acceptedBy: "user-1",
    acceptedAt: "2026-09-19T10:00:00.000Z",
    reversalOfId: null,
    evidenceFileId: null,
    grossTotal: "200.0000",
    ...overrides,
  };
}

function line(overrides: Partial<GoodsReceiptLineRecord> = {}): GoodsReceiptLineRecord {
  return {
    id: "line-1",
    goodsReceiptId: "receipt-1",
    supplierItemId: "si-1",
    itemId: "item-1",
    receivedPackQty: "2.000000",
    acceptedPackQty: "1.500000",
    rejectedPackQty: "0.500000",
    unitId: "unit-1",
    packToBaseFactor: "1000.000000",
    price: "100.0000",
    discount: "0.0000",
    taxBasis: "exclusive",
    taxCodeId: null,
    appliedTaxRate: null,
    allocatedFreight: "0.0000",
    importFee: "0.0000",
    lotNumber: "LOT-1",
    expiryDate: "2027-01-01",
    baseQtyAccepted: "1500.000000",
    landedBaseUnitCost: "0.0667",
    ...overrides,
  };
}

function refs(
  overrides: Partial<{
    suppliers: Map<string, ReceivingSupplierOption>;
    locations: Map<string, ReceivingLocationRecord>;
    items: Map<string, ReceivingItem>;
    units: Map<string, ReceivingUnit>;
  }> = {},
): ReceiptRefs {
  return {
    suppliers:
      overrides.suppliers ??
      new Map([
        [
          "sup-1",
          { id: "sup-1", organizationId: ORG, code: "S1", name: "Supplier One", currency: "NOK" },
        ],
      ]),
    locations:
      overrides.locations ??
      new Map([["loc-1", { id: "loc-1", organizationId: ORG, code: "CAFE", name: "Café" }]]),
    items:
      overrides.items ??
      new Map([
        [
          "item-1",
          { id: "item-1", organizationId: ORG, code: "ITEM-1", name: "Item One", baseUnitId: "g" },
        ],
      ]),
    units:
      overrides.units ??
      new Map([
        [
          "unit-1",
          { id: "unit-1", organizationId: ORG, code: "pack", dimension: "package", isBase: false },
        ],
      ]),
  };
}

describe("parseReceiptListQuery", () => {
  it("treats absent filters as empty and accepts bounded values", () => {
    const locationId = "11111111-1111-4111-8111-111111111111";
    const supplierId = "22222222-2222-4222-8222-222222222222";
    const empty = parseReceiptListQuery(new URLSearchParams());
    const bounded = parseReceiptListQuery(
      new URLSearchParams({ locationId, supplierId, limit: "10", offset: "5" }),
    );

    expect(empty).toEqual({ ok: true, query: {} });
    expect(bounded).toEqual({
      ok: true,
      query: { locationId, supplierId, limit: 10, offset: 5 },
    });
  });

  it("rejects malformed filters and out-of-range paging", () => {
    expect(parseReceiptListQuery(new URLSearchParams({ locationId: "nope" })).ok).toBe(false);
    expect(parseReceiptListQuery(new URLSearchParams({ supplierId: "nope" })).ok).toBe(false);
    expect(parseReceiptListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseReceiptListQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
    expect(parseReceiptListQuery(new URLSearchParams({ limit: "abc" })).ok).toBe(false);
    expect(parseReceiptListQuery(new URLSearchParams({ offset: "-1" })).ok).toBe(false);
  });
});

describe("toReceiptRows", () => {
  it("drops another organization's receipt and never echoes foreign references", () => {
    const foreign = summary({ id: "foreign", organizationId: OTHER });
    const foreignSupplier = summary({ id: "foreign-sup", supplierId: "sup-foreign" });
    const rows = toReceiptRows(
      ORG,
      [summary(), foreign, foreignSupplier],
      refs({
        suppliers: new Map([
          [
            "sup-1",
            { id: "sup-1", organizationId: ORG, code: "S1", name: "Supplier One", currency: "NOK" },
          ],
          [
            "sup-foreign",
            {
              id: "sup-foreign",
              organizationId: OTHER,
              code: "S2",
              name: "Elsewhere",
              currency: "NOK",
            },
          ],
        ]),
      }),
    );

    expect(rows.map((row) => row.id)).toEqual(["receipt-1", "foreign-sup"]);
    expect(rows[0]).toMatchObject({
      supplierName: "Supplier One",
      locationCode: "CAFE",
      locationName: "Café",
      grossTotal: "200.0000",
    });
    expect(rows[1]!.supplierName).toBeNull();
  });

  it("leaves unknown references null instead of inventing a label", () => {
    const rows = toReceiptRows(ORG, [summary({ supplierId: null })], refs());

    expect(rows[0]).toMatchObject({ supplierName: null, locationCode: "CAFE" });
  });
});

describe("toReceiptLineRows", () => {
  it("enriches an item and its pack unit", () => {
    const rows = toReceiptLineRows(ORG, [line()], refs());

    expect(rows[0]).toMatchObject({
      itemCode: "ITEM-1",
      itemName: "Item One",
      unitCode: "pack",
      baseQtyAccepted: "1500.000000",
      landedBaseUnitCost: "0.0667",
    });
  });

  it("drops a unit or item owned by another organization", () => {
    const rows = toReceiptLineRows(
      ORG,
      [line()],
      refs({
        units: new Map([
          [
            "unit-1",
            {
              id: "unit-1",
              organizationId: OTHER,
              code: "pack",
              dimension: "package",
              isBase: false,
            },
          ],
        ]),
        items: new Map([
          [
            "item-1",
            {
              id: "item-1",
              organizationId: OTHER,
              code: "ITEM-1",
              name: "Item One",
              baseUnitId: "g",
            },
          ],
        ]),
      }),
    );

    expect(rows[0]!.unitCode).toBeNull();
    expect(rows[0]!.itemCode).toBeNull();
  });
});
