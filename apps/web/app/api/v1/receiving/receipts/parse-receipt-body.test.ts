import { describe, expect, it } from "vitest";

import { parseReceiptBody } from "./parse-receipt-body";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const PACK_UNIT = "44444444-4444-4444-8444-444444444444";
const TAX_RULE = "55555555-5555-4555-8555-555555555555";
const CHANNEL = "66666666-6666-4666-8666-666666666666";

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locationId: LOCATION,
    supplierId: SUPPLIER,
    receivedAt: "2026-09-19T10:00:00.000Z",
    lines: [
      {
        itemId: ITEM,
        unitId: PACK_UNIT,
        receivedPackQty: "2",
        acceptedPackQty: "2",
        packToBaseFactor: "1000",
        price: "100",
        taxBasis: "exclusive",
      },
    ],
    ...overrides,
  };
}

describe("parseReceiptBody", () => {
  it("accepts a supplier receipt and normalises absent optionals to null", () => {
    const parsed = parseReceiptBody(baseBody({ deliveryRef: "  slip-1  " }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.locationId).toBe(LOCATION);
    expect(parsed.input.supplierId).toBe(SUPPLIER);
    expect(parsed.input.storeName).toBeNull();
    expect(parsed.input.deliveryRef).toBe("slip-1");
    expect(parsed.input.receivedAt).toBe("2026-09-19T10:00:00.000Z");

    const line = parsed.input.lines[0]!;
    expect(line.supplierItemId).toBeNull();
    expect(line.rejectedPackQty).toBe("0");
    expect(line.discount).toBe("0");
    expect(line.allocatedFreight).toBe("0");
    expect(line.importFee).toBe("0");
    expect(line.lotNumber).toBeNull();
    expect(line.expiryDate).toBeNull();
    expect(line.recoverableTax).toBeUndefined();
  });

  it("accepts an ad-hoc store purchase without a supplier", () => {
    const parsed = parseReceiptBody(
      baseBody({ supplierId: null, storeName: "Rema 1000", currency: "NOK" }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.supplierId).toBeNull();
    expect(parsed.input.storeName).toBe("Rema 1000");
    expect(parsed.input.currency).toBe("NOK");
  });

  it("rejects a purchase with neither a supplier nor a store name", () => {
    expect(parseReceiptBody(baseBody({ supplierId: null, storeName: null })).ok).toBe(false);
  });

  it("carries an inclusive line's recoverable tax through unchanged", () => {
    const parsed = parseReceiptBody(
      baseBody({
        lines: [
          {
            itemId: ITEM,
            unitId: PACK_UNIT,
            receivedPackQty: "1",
            acceptedPackQty: "1",
            packToBaseFactor: "1000",
            price: "125",
            taxBasis: "inclusive",
            recoverableTax: "25",
            lotNumber: "LOT-1",
            expiryDate: "2027-01-01",
          },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.lines[0]).toMatchObject({
      taxBasis: "inclusive",
      recoverableTax: "25",
      lotNumber: "LOT-1",
      expiryDate: "2027-01-01",
    });
  });

  it("carries the linked tax rule and channel, and rejects a malformed one", () => {
    const line = {
      itemId: ITEM,
      unitId: PACK_UNIT,
      receivedPackQty: "1",
      acceptedPackQty: "1",
      packToBaseFactor: "1000",
      price: "125",
      taxBasis: "inclusive",
    };
    const parsed = parseReceiptBody(
      baseBody({ lines: [{ ...line, taxCodeId: TAX_RULE, channelId: CHANNEL }] }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.lines[0]).toMatchObject({ taxCodeId: TAX_RULE, channelId: CHANNEL });

    expect(parseReceiptBody(baseBody({ lines: [{ ...line, taxCodeId: "not-a-uuid" }] })).ok).toBe(
      false,
    );
    expect(parseReceiptBody(baseBody({ lines: [{ ...line, channelId: "nope" }] })).ok).toBe(false);
  });

  it("rejects shape violations before any domain rule runs", () => {
    expect(parseReceiptBody(null).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ locationId: "not-a-uuid" })).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ supplierId: "not-a-uuid" })).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ deliveryRef: 5 })).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ receivedAt: "19/09/2026" })).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ lines: [] })).ok).toBe(false);
    expect(parseReceiptBody(baseBody({ currency: "" })).ok).toBe(true);
    expect(parseReceiptBody(baseBody({ lines: [{ itemId: ITEM, unitId: PACK_UNIT }] })).ok).toBe(
      false,
    );
    expect(
      parseReceiptBody(
        baseBody({
          lines: [
            {
              itemId: ITEM,
              unitId: PACK_UNIT,
              receivedPackQty: "2",
              acceptedPackQty: "2",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "bogus",
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseReceiptBody(
        baseBody({
          lines: [
            {
              itemId: ITEM,
              unitId: PACK_UNIT,
              receivedPackQty: "2",
              acceptedPackQty: "2",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
              expiryDate: "2027/01/01",
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });
});
