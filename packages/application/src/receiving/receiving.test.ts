import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it } from "vitest";

import type { TaxRuleRecord } from "../tax/read-types";

import {
  recordGoodsReceipt,
  type RecordGoodsReceiptInput,
  type RecordGoodsReceiptLineInput,
} from "./record-goods-receipt";
import { FakeReceivingStore } from "./test-support";

const ORG = "org-1";
const RECEIVED_AT = new Date("2026-09-19T10:00:00.000Z");

/** A resolvable `tax_rule` for the fake store; `recoverable` and rate default to a normal 25 %. */
function taxRule(overrides: Partial<TaxRuleRecord> & { readonly id: string }): TaxRuleRecord {
  return {
    organizationId: ORG,
    code: overrides.id,
    name: overrides.id,
    ratePct: "0.250000",
    taxBasis: "inclusive",
    taxTreatment: "channel_overridable",
    recoverable: true,
    appliesTo: "cost",
    scopeType: "company_wide",
    locationId: null,
    channelId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    ...overrides,
  };
}

function buildStore(): FakeReceivingStore {
  const store = new FakeReceivingStore();
  store.units.set("g", {
    id: "g",
    organizationId: ORG,
    code: "g",
    dimension: "mass",
    isBase: true,
  });
  store.units.set("pack", {
    id: "pack",
    organizationId: ORG,
    code: "pack",
    dimension: "package",
    isBase: false,
  });
  store.units.set("ml", {
    id: "ml",
    organizationId: ORG,
    code: "ml",
    dimension: "volume",
    isBase: true,
  });
  store.items.set("item-1", {
    id: "item-1",
    organizationId: ORG,
    code: "ITEM-1",
    name: "Item 1",
    baseUnitId: "g",
  });
  store.suppliers.set("sup-1", { id: "sup-1", organizationId: ORG });
  store.supplierItems.set("si-1", {
    id: "si-1",
    organizationId: ORG,
    supplierId: "sup-1",
    itemId: "item-1",
    packUnitId: "pack",
    packToBaseUnitFactor: "1000",
  });
  return store;
}

function baseInput(overrides: Partial<RecordGoodsReceiptInput> = {}): RecordGoodsReceiptInput {
  return {
    organizationId: ORG,
    locationId: "loc-1",
    actorId: "user-1",
    receivedAt: RECEIVED_AT,
    supplierId: "sup-1",
    lines: [
      {
        supplierItemId: "si-1",
        itemId: "item-1",
        receivedPackQty: "2",
        acceptedPackQty: "2",
        unitId: "pack",
        packToBaseFactor: "1000",
        price: "100",
        discount: "5",
        taxBasis: "exclusive",
        allocatedFreight: "3",
        importFee: "2",
      },
    ],
    ...overrides,
  };
}

describe("recordGoodsReceipt", () => {
  let store: FakeReceivingStore;

  beforeEach(() => {
    store = buildStore();
  });

  it("records an accepted receipt and computes the §5 landed base-unit cost", async () => {
    const result = await recordGoodsReceipt(store, baseInput());

    expect(result.goodsReceiptId).toBe("receipt-1");
    expect(result.lines[0]).toMatchObject({
      netPackPrice: "95.0000",
      landedPackCost: "100.0000",
      baseQtyAccepted: "2000.000000",
      landedBaseUnitCost: "0.0500",
      priceHistoryKind: "supplier_price",
    });
    expect(store.receipts[0]).toMatchObject({
      status: "accepted",
      acceptedBy: "user-1",
      acceptedAt: RECEIVED_AT,
      supplierId: "sup-1",
    });
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]).toMatchObject({
      baseQtyAccepted: "2000.000000",
      landedBaseUnitCost: "0.0500",
      taxBasis: "exclusive",
    });
    // One audit row inside the same transaction, fixed non-secret fields only.
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: "receiving.goods_receipt.recorded",
      entityType: "goods_receipt",
      entityId: "receipt-1",
      // Fixed, derived and secret-free: price × received packs, at money scale.
      after: { status: "accepted", lineCount: 1, gross_total: "200.0000" },
    });
  });

  it("appends an effective-dated supplier_price and closes the previous window", async () => {
    await recordGoodsReceipt(store, baseInput());
    const later = new Date("2026-10-01T10:00:00.000Z");
    await recordGoodsReceipt(store, {
      ...baseInput(),
      receivedAt: later,
      lines: [{ ...baseInput().lines[0]!, price: "200" }],
    });

    expect(store.supplierPrices).toHaveLength(2);
    expect(store.supplierPrices[0]).toMatchObject({
      grossPackPrice: "100",
      landedBaseUnitCost: "0.0500",
      effectiveTo: later,
      sourceReceiptId: "receipt-1",
    });
    expect(store.supplierPrices[1]).toMatchObject({
      grossPackPrice: "200",
      effectiveTo: null,
      sourceReceiptId: "receipt-2",
    });
    expect(store.costObservations).toHaveLength(0);
  });

  it("falls back to a cost_observation for an ad-hoc purchase with no supplier", async () => {
    const result = await recordGoodsReceipt(
      store,
      baseInput({
        supplierId: null,
        storeName: "Rema 1000",
        lines: [
          {
            itemId: "item-1",
            receivedPackQty: "2",
            acceptedPackQty: "2",
            unitId: "pack",
            packToBaseFactor: "1000",
            price: "100",
            taxBasis: "exclusive",
          },
        ],
      }),
    );

    expect(result.lines[0]!.priceHistoryKind).toBe("cost_observation");
    expect(store.supplierPrices).toHaveLength(0);
    expect(store.costObservations).toHaveLength(1);
    expect(store.costObservations[0]).toMatchObject({
      itemId: "item-1",
      storeName: "Rema 1000",
      observedAt: "2026-09-19",
      packSize: "1000",
      packUnitId: "g",
      packPrice: "100",
      source: "receipt",
      notes: "tax basis: exclusive",
    });
  });

  it("subtracts an explicit recoverable tax for an inclusive price", async () => {
    const result = await recordGoodsReceipt(
      store,
      baseInput({
        lines: [
          {
            supplierItemId: "si-1",
            itemId: "item-1",
            receivedPackQty: "1",
            acceptedPackQty: "1",
            unitId: "pack",
            packToBaseFactor: "1000",
            price: "125",
            taxBasis: "inclusive",
            recoverableTax: "25",
          },
        ],
      }),
    );

    expect(result.lines[0]!.netPackPrice).toBe("100.0000");
    expect(result.lines[0]!.landedBaseUnitCost).toBe("0.1000");
  });

  it("rejects an inclusive price with no recoverable tax (tax-basis resolution undecided)", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              supplierItemId: "si-1",
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "125",
              taxBasis: "inclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/recoverableTax is required/);
    expect(store.receipts).toHaveLength(0);
  });

  it("rejects a recoverable tax on an exclusive price", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              supplierItemId: "si-1",
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
              recoverableTax: "25",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/must not be supplied for an exclusive price/);
  });

  describe("inclusive tax resolved from the linked tax rule (PRICE-006)", () => {
    function inclusiveLine(overrides: Partial<RecordGoodsReceiptLineInput> = {}) {
      return {
        supplierItemId: "si-1",
        itemId: "item-1",
        receivedPackQty: "1",
        acceptedPackQty: "1",
        unitId: "pack",
        packToBaseFactor: "1000",
        price: "125",
        taxBasis: "inclusive",
        ...overrides,
      };
    }

    it("resolves the rate of a fixed linked rule and derives the embedded tax", async () => {
      store.taxRules.set(
        "fixed-vat",
        taxRule({ id: "fixed-vat", taxTreatment: "fixed", ratePct: "0.250000" }),
      );
      const result = await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ taxCodeId: "fixed-vat" })] }),
      );

      // 125 inclusive at 25 % -> 25 tax embedded -> 100 net.
      expect(result.lines[0]!.netPackPrice).toBe("100.0000");
      expect(result.lines[0]!.landedBaseUnitCost).toBe("0.1000");
      expect(store.supplierPrices[0]).toMatchObject({ netPackPrice: "100.0000" });
      // The rate that produced the tax is captured on the row (`DEC-075`).
      expect(store.lines[0]).toMatchObject({ appliedTaxRate: "0.250000" });
    });

    it("resolves the same numbers an explicit 25 % amount produced before (regression guard)", async () => {
      store.taxRules.set(
        "fixed-vat",
        taxRule({ id: "fixed-vat", taxTreatment: "fixed", ratePct: "0.250000" }),
      );
      const resolved = await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ taxCodeId: "fixed-vat" })] }),
      );
      const explicitStore = buildStore();
      const explicit = await recordGoodsReceipt(
        explicitStore,
        baseInput({ lines: [inclusiveLine({ recoverableTax: "25" })] }),
      );

      expect(resolved.lines[0]).toMatchObject({
        netPackPrice: explicit.lines[0]!.netPackPrice,
        landedPackCost: explicit.lines[0]!.landedPackCost,
        landedBaseUnitCost: explicit.lines[0]!.landedBaseUnitCost,
      });
      expect(resolved.lines[0]!.netPackPrice).toBe("100.0000");
    });

    it("resolves a channel-scoped override for a channel-overridable linked rule", async () => {
      store.taxRules.set(
        "vat-default",
        taxRule({ id: "vat-default", appliesTo: "cost", ratePct: "0.250000" }),
      );
      store.taxRules.set(
        "vat-takeaway",
        taxRule({
          id: "vat-takeaway",
          appliesTo: "cost",
          scopeType: "channel",
          channelId: "chan-out",
          ratePct: "0.150000",
        }),
      );
      const result = await recordGoodsReceipt(
        store,
        baseInput({
          lines: [inclusiveLine({ price: "115", taxCodeId: "vat-default", channelId: "chan-out" })],
        }),
      );

      // 115 inclusive at the 15 % channel override -> 15 tax -> 100 net.
      expect(result.lines[0]!.netPackPrice).toBe("100.0000");
      expect(result.lines[0]!.landedBaseUnitCost).toBe("0.1000");
    });

    it("resolves a location-scoped override from the receipt's location", async () => {
      store.taxRules.set(
        "vat-default",
        taxRule({ id: "vat-default", appliesTo: "cost", ratePct: "0.250000" }),
      );
      store.taxRules.set(
        "vat-loc",
        taxRule({
          id: "vat-loc",
          appliesTo: "cost",
          scopeType: "location",
          locationId: "loc-1",
          ratePct: "0.120000",
        }),
      );
      const result = await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ price: "112", taxCodeId: "vat-default" })] }),
      );

      // 112 inclusive at the 12 % location override -> 12 tax -> 100 net.
      expect(result.lines[0]!.netPackPrice).toBe("100.0000");
    });

    it("subtracts no tax when the linked rule is not recoverable (§2)", async () => {
      store.taxRules.set(
        "blocked-vat",
        taxRule({ id: "blocked-vat", taxTreatment: "fixed", recoverable: false }),
      );
      const result = await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ taxCodeId: "blocked-vat" })] }),
      );

      expect(result.lines[0]!.netPackPrice).toBe("125.0000");
      expect(result.lines[0]!.landedBaseUnitCost).toBe("0.1250");
    });

    it("stores the resolved rate on the rule-derived path, not a re-derived one", async () => {
      store.taxRules.set(
        "fixed-vat",
        taxRule({ id: "fixed-vat", taxTreatment: "fixed", ratePct: "0.250000" }),
      );
      const result = await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ taxCodeId: "fixed-vat" })] }),
      );

      // The stored rate is exactly what `resolveTaxRule` returned, so a later
      // edit to the rule cannot change how this row's cost re-derives.
      expect(store.lines[0]).toMatchObject({
        appliedTaxRate: "0.250000",
        landedBaseUnitCost: result.lines[0]!.landedBaseUnitCost,
      });
    });

    it("captures the channel override's rate, so the stored rate is self-describing", async () => {
      store.taxRules.set(
        "vat-default",
        taxRule({ id: "vat-default", appliesTo: "cost", ratePct: "0.250000" }),
      );
      store.taxRules.set(
        "vat-takeaway",
        taxRule({
          id: "vat-takeaway",
          appliesTo: "cost",
          scopeType: "channel",
          channelId: "chan-out",
          ratePct: "0.150000",
        }),
      );
      await recordGoodsReceipt(
        store,
        baseInput({
          lines: [inclusiveLine({ price: "115", taxCodeId: "vat-default", channelId: "chan-out" })],
        }),
      );

      // The winning rate (the 15 % override), not the item default's 25 %.
      expect(store.lines[0]).toMatchObject({ appliedTaxRate: "0.150000" });
    });

    it("stores null when the caller states the recoverable amount, not a rate", async () => {
      await recordGoodsReceipt(
        store,
        baseInput({ lines: [inclusiveLine({ recoverableTax: "25" })] }),
      );

      // An explicit amount is not a rate; null is the honest value (`DEC-075`).
      expect(store.lines[0]).toMatchObject({ appliedTaxRate: null, landedBaseUnitCost: "0.1000" });
    });

    it("stores null on an exclusive price, which carries no recoverable rate", async () => {
      await recordGoodsReceipt(store, baseInput());

      expect(store.lines[0]).toMatchObject({ appliedTaxRate: null, landedBaseUnitCost: "0.0500" });
    });

    it("refuses an explicit amount alongside a linked rule rather than pick an authority", async () => {
      store.taxRules.set("fixed-vat", taxRule({ id: "fixed-vat", taxTreatment: "fixed" }));
      await expect(
        recordGoodsReceipt(
          store,
          baseInput({
            lines: [inclusiveLine({ taxCodeId: "fixed-vat", recoverableTax: "25" })],
          }),
        ),
      ).rejects.toThrow(/must not be supplied alongside a linked tax rule/);
      expect(store.receipts).toHaveLength(0);
    });

    it("surfaces the resolver's refusal when the linked rule is not effective", async () => {
      store.taxRules.set("fixed-vat", taxRule({ id: "fixed-vat", taxTreatment: "fixed" }));
      await expect(
        recordGoodsReceipt(
          store,
          baseInput({ lines: [inclusiveLine({ taxCodeId: "missing-vat" })] }),
        ),
      ).rejects.toThrow(/is not effective for this organization/);
      expect(store.receipts).toHaveLength(0);
    });

    it("refuses an inclusive price with no rule to resolve and no explicit amount", async () => {
      await expect(
        recordGoodsReceipt(store, baseInput({ lines: [inclusiveLine()] })),
      ).rejects.toThrow(
        /recoverableTax is required for an inclusive price with no linked tax rule/,
      );
    });
  });

  it("rejects a discount greater than the price (negative net pack price)", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              supplierItemId: "si-1",
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              discount: "100.01",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow("net pack price must not be negative");
  });

  it("rejects accepted > received and a non-positive accepted quantity", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "2",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/must not exceed receivedPackQty/);

    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "0",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/must be positive/);
    expect(store.lines).toHaveLength(0);
  });

  it("rejects a non-positive factor and an item outside the organization", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "0",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/packToBaseFactor must be positive/);

    store.items.set("item-2", {
      id: "item-2",
      organizationId: "other",
      code: "ITEM-2",
      name: "Item 2",
      baseUnitId: "g",
    });
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              itemId: "item-2",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow("item not found in organization");
  });

  it("rejects a supplier item when the receipt has no supplier", async () => {
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          supplierId: null,
          storeName: "Rema 1000",
          lines: [
            {
              supplierItemId: "si-1",
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/does not belong to the receipt supplier/);
  });

  it("rejects a supplier item whose item does not match the received line", async () => {
    store.supplierItems.set("si-2", {
      id: "si-2",
      organizationId: ORG,
      supplierId: "sup-1",
      itemId: "other-item",
      packUnitId: "pack",
      packToBaseUnitFactor: "1000",
    });
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              supplierItemId: "si-2",
              itemId: "item-1",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "pack",
              packToBaseFactor: "1000",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/does not match the received item/);
  });

  it("rejects an incompatible pack dimension and an empty line list", async () => {
    store.items.set("item-ml", {
      id: "item-ml",
      organizationId: ORG,
      code: "ITEM-ML",
      name: "Item ml",
      baseUnitId: "ml",
    });
    await expect(
      recordGoodsReceipt(
        store,
        baseInput({
          lines: [
            {
              itemId: "item-ml",
              receivedPackQty: "1",
              acceptedPackQty: "1",
              unitId: "g",
              packToBaseFactor: "1",
              price: "100",
              taxBasis: "exclusive",
            },
          ],
        }),
      ),
    ).rejects.toThrow(DomainError);

    await expect(recordGoodsReceipt(store, baseInput({ lines: [] }))).rejects.toThrow(
      /at least one line/,
    );
  });
});
