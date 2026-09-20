import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { getGoodsReceipt, listGoodsReceipts } from "./receipts";
import { FakeReceivingStore } from "./test-support";
import type { NewReceiptLineRecord } from "./types";

const ORG = "org-1";
const OTHER = "org-2";
const RECEIVED_AT = new Date("2026-09-10T10:00:00.000Z");

function line(
  goodsReceiptId: string,
  price: string,
  receivedPackQty: string,
): NewReceiptLineRecord {
  return {
    goodsReceiptId,
    supplierItemId: null,
    itemId: "item-1",
    receivedPackQty,
    acceptedPackQty: receivedPackQty,
    rejectedPackQty: "0",
    unitId: "pack",
    packToBaseFactor: "1000",
    price,
    discount: "0",
    taxBasis: "exclusive",
    taxCodeId: null,
    allocatedFreight: "0",
    importFee: "0",
    lotNumber: null,
    expiryDate: null,
    baseQtyAccepted: "2000.000000",
    landedBaseUnitCost: "0.0500",
  };
}

async function addReceipt(
  store: FakeReceivingStore,
  overrides: {
    readonly organizationId?: string;
    readonly locationId?: string;
    readonly supplierId?: string | null;
    readonly receivedAt?: Date;
  } = {},
): Promise<string> {
  const receivedAt = overrides.receivedAt ?? RECEIVED_AT;
  const created = await store.createGoodsReceipt({
    organizationId: overrides.organizationId ?? ORG,
    supplierId: overrides.supplierId ?? null,
    storeName: "Test Store",
    locationId: overrides.locationId ?? "loc-1",
    purchaseOrderId: null,
    deliveryRef: null,
    receivedAt,
    status: "accepted",
    acceptedBy: "user-1",
    acceptedAt: receivedAt,
    evidenceFileId: null,
  });
  return created.id;
}

describe("listGoodsReceipts", () => {
  let store: FakeReceivingStore;

  beforeEach(() => {
    store = new FakeReceivingStore();
  });

  it("returns the organization's receipts newest first with a derived gross total", async () => {
    const older = await addReceipt(store, {
      receivedAt: new Date("2026-09-01T10:00:00.000Z"),
      supplierId: "sup-1",
    });
    const newer = await addReceipt(store, {
      receivedAt: new Date("2026-09-09T10:00:00.000Z"),
      supplierId: "sup-2",
    });
    await store.createGoodsReceiptLine(line(older, "10", "2"));
    await store.createGoodsReceiptLine(line(newer, "7.5", "4"));

    const receipts = await listGoodsReceipts(store, { organizationId: ORG });

    expect(receipts.map((receipt) => receipt.id)).toEqual([newer, older]);
    expect(receipts[0]!.grossTotal).toBe("30.0000");
    expect(receipts[1]!.grossTotal).toBe("20.0000");
  });

  it("never returns another organization's receipts", async () => {
    const mine = await addReceipt(store);
    await addReceipt(store, { organizationId: OTHER });

    const receipts = await listGoodsReceipts(store, { organizationId: ORG });

    expect(receipts.map((receipt) => receipt.id)).toEqual([mine]);
  });

  it("applies optional location and supplier filters", async () => {
    const match = await addReceipt(store, { locationId: "loc-a", supplierId: "sup-a" });
    const otherLocation = await addReceipt(store, { locationId: "loc-a", supplierId: "sup-b" });
    const otherSupplier = await addReceipt(store, { locationId: "loc-b", supplierId: "sup-a" });

    const byLocation = await listGoodsReceipts(store, {
      organizationId: ORG,
      locationId: "loc-a",
    });
    const bySupplier = await listGoodsReceipts(store, {
      organizationId: ORG,
      supplierId: "sup-a",
    });

    expect(new Set(byLocation.map((receipt) => receipt.id))).toEqual(
      new Set([match, otherLocation]),
    );
    expect(new Set(bySupplier.map((receipt) => receipt.id))).toEqual(
      new Set([match, otherSupplier]),
    );
  });

  it("pages with the default and explicit bounds", async () => {
    for (let index = 0; index < 3; index += 1) {
      await addReceipt(store, { receivedAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`) });
    }

    const firstPage = await listGoodsReceipts(store, { organizationId: ORG, limit: 2 });
    const secondPage = await listGoodsReceipts(store, { organizationId: ORG, limit: 2, offset: 2 });
    const defaulted = await listGoodsReceipts(store, { organizationId: ORG });

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect(defaulted).toHaveLength(3);
  });

  it("rejects an out-of-range limit or a negative offset", async () => {
    await expect(listGoodsReceipts(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(listGoodsReceipts(store, { organizationId: ORG, limit: 201 })).rejects.toThrow(
      DomainError,
    );
    await expect(listGoodsReceipts(store, { organizationId: ORG, limit: 1.5 })).rejects.toThrow(
      DomainError,
    );
    await expect(listGoodsReceipts(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
    await expect(listGoodsReceipts(store, { organizationId: "  " })).rejects.toThrow(DomainError);
  });
});

describe("getGoodsReceipt", () => {
  let store: FakeReceivingStore;

  beforeEach(() => {
    store = new FakeReceivingStore();
  });

  it("returns one receipt with its lines", async () => {
    const receiptId = await addReceipt(store, { supplierId: "sup-1" });
    await store.createGoodsReceiptLine(line(receiptId, "10", "2"));
    await store.createGoodsReceiptLine(line(receiptId, "5", "1"));

    const detail = await getGoodsReceipt(store, { organizationId: ORG, receiptId });

    expect(detail?.receipt.id).toBe(receiptId);
    expect(detail?.lines).toHaveLength(2);
  });

  it("treats a receipt from another organization as absent", async () => {
    const foreign = await addReceipt(store, { organizationId: OTHER });

    const detail = await getGoodsReceipt(store, { organizationId: ORG, receiptId: foreign });

    expect(detail).toBeUndefined();
  });

  it("treats an unknown receipt as absent", async () => {
    const detail = await getGoodsReceipt(store, { organizationId: ORG, receiptId: "missing" });

    expect(detail).toBeUndefined();
  });
});
