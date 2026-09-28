import { DEFAULT_ITEMS_LIMIT, MAX_ITEMS_LIMIT } from "@aquarela/application";
import type {
  CatalogItemRecord,
  ConversionEdge,
  ItemDetail,
  SupplierItemDetail,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  isUuid,
  parseItemsQuery,
  toConversionRow,
  toItemDetailResponse,
  toItemRow,
  toSupplierPackRow,
} from "./product-rows";

const ITEM: CatalogItemRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  code: "BEANS",
  sku: "BEANS-1KG",
  name: "Espresso Beans",
  itemType: "ingredient",
  purpose: "for_use",
  baseUnitId: "unit-1",
  baseUnitCode: "g",
  inventoryPolicy: "stocked",
  lotTracked: true,
  currentCost: "0.2500",
  activeFrom: "2026-01-01",
  activeTo: null,
};

const PACK: SupplierItemDetail = {
  id: "si-1",
  organizationId: "org-1",
  supplierId: "sup-1",
  supplierCode: "SUP",
  supplierName: "Demo Supplier",
  itemId: ITEM.id,
  supplierSku: "BEANS-25KG",
  packUnitId: "pack",
  packUnitCode: "pack",
  packToBaseUnitFactor: "25000.000000",
  minOrderQty: "1.000000",
  leadTimeDays: 2,
  preferred: true,
};

const CONVERSION: ConversionEdge = {
  fromUnit: { id: "kg", code: "kg", dimension: "mass", isBase: false },
  toUnit: { id: "g", code: "g", dimension: "mass", isBase: true },
  factor: "1000.000000",
  itemId: ITEM.id,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
};

describe("parseItemsQuery", () => {
  it("defaults the page and omits absent filters", () => {
    const parsed = parseItemsQuery(new URLSearchParams());
    expect(parsed).toEqual({
      ok: true,
      query: { limit: DEFAULT_ITEMS_LIMIT, offset: 0 },
    });
  });

  it("reads search, itemType, purpose, limit and offset", () => {
    const parsed = parseItemsQuery(
      new URLSearchParams({
        search: " beans ",
        itemType: "ingredient",
        purpose: "for_use",
        limit: "10",
        offset: "20",
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      query: { search: "beans", itemType: "ingredient", purpose: "for_use", limit: 10, offset: 20 },
    });
  });

  it("rejects an unknown purpose", () => {
    expect(parseItemsQuery(new URLSearchParams({ purpose: "for_fun" }))).toEqual({ ok: false });
  });

  it("treats blank filters as absent", () => {
    const parsed = parseItemsQuery(new URLSearchParams({ search: "  ", itemType: "" }));
    expect(parsed).toEqual({ ok: true, query: { limit: DEFAULT_ITEMS_LIMIT, offset: 0 } });
  });

  it("rejects a malformed or out-of-range page", () => {
    expect(parseItemsQuery(new URLSearchParams({ limit: "abc" }))).toEqual({ ok: false });
    expect(parseItemsQuery(new URLSearchParams({ offset: "-1" }))).toEqual({ ok: false });
    expect(parseItemsQuery(new URLSearchParams({ limit: "0" }))).toEqual({ ok: false });
    expect(parseItemsQuery(new URLSearchParams({ limit: String(MAX_ITEMS_LIMIT + 1) }))).toEqual({
      ok: false,
    });
  });
});

describe("response mapping", () => {
  it("picks the item wire fields", () => {
    expect(toItemRow(ITEM)).toEqual({
      id: ITEM.id,
      code: "BEANS",
      sku: "BEANS-1KG",
      name: "Espresso Beans",
      itemType: "ingredient",
      purpose: "for_use",
      baseUnitId: "unit-1",
      baseUnitCode: "g",
      inventoryPolicy: "stocked",
      lotTracked: true,
      currentCost: "0.2500",
      activeFrom: "2026-01-01",
      activeTo: null,
    });
  });

  it("maps a supplier pack and a conversion with ISO dates", () => {
    expect(toSupplierPackRow(PACK)).toMatchObject({
      supplierCode: "SUP",
      packUnitCode: "pack",
      packToBaseUnitFactor: "25000.000000",
      preferred: true,
    });
    expect(toConversionRow(CONVERSION)).toEqual({
      fromUnitId: "kg",
      fromUnitCode: "kg",
      toUnitId: "g",
      toUnitCode: "g",
      factor: "1000.000000",
      itemId: ITEM.id,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
    });
  });

  it("composes the detail response", () => {
    const detail: ItemDetail = {
      item: ITEM,
      supplierItems: [PACK],
      conversions: [CONVERSION],
      variantBackings: [],
    };
    const response = toItemDetailResponse(detail);
    expect(response.item.code).toBe("BEANS");
    expect(response.supplierItems).toHaveLength(1);
    expect(response.conversions).toHaveLength(1);
  });

  it("validates UUIDs", () => {
    expect(isUuid(ITEM.id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
