import { describe, expect, it } from "vitest";

import {
  parseAddonApplicabilityBody,
  parseRecipeAssignmentBody,
  parseRegisterProductBody,
  parseRegisterVariantBody,
  parseUpdateVariantBody,
  toProductWithVariantsRow,
  toVariantDetailRow,
} from "./sellable-rows";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("parseRegisterProductBody", () => {
  it("trims, defaults the kind and accepts an optional category", () => {
    expect(parseRegisterProductBody({ code: " CAKE ", name: " Cake " })).toEqual({
      ok: true,
      input: { code: "CAKE", name: "Cake", productKind: "base" },
    });
    expect(
      parseRegisterProductBody({
        code: "X",
        name: "X",
        productKind: "add_on",
        category: "Dessert",
      }),
    ).toEqual({
      ok: true,
      input: { code: "X", name: "X", productKind: "add_on", category: "Dessert" },
    });
  });

  it("rejects a missing field, an unknown kind and a non-object body", () => {
    expect(parseRegisterProductBody({ code: "X" })).toEqual({ ok: false });
    expect(parseRegisterProductBody({ code: "X", name: "X", productKind: "x" })).toEqual({
      ok: false,
    });
    expect(parseRegisterProductBody(undefined)).toEqual({ ok: false });
  });
});

describe("parseRegisterVariantBody", () => {
  it("accepts an omitted and a valid finished-good item", () => {
    expect(parseRegisterVariantBody({ code: "V", sku: "S", name: "V" })).toEqual({
      ok: true,
      input: { code: "V", sku: "S", name: "V" },
    });
    expect(
      parseRegisterVariantBody({
        code: "V",
        sku: "S",
        name: "V",
        size: "8",
        finishedGoodItemId: UUID_A,
      }),
    ).toEqual({
      ok: true,
      input: { code: "V", sku: "S", name: "V", size: "8", finishedGoodItemId: UUID_A },
    });
  });

  it("rejects a malformed finished-good item and a missing field", () => {
    expect(
      parseRegisterVariantBody({
        code: "V",
        sku: "S",
        name: "V",
        finishedGoodItemId: "not-a-uuid",
      }),
    ).toEqual({ ok: false });
    expect(parseRegisterVariantBody({ code: "V", name: "V" })).toEqual({ ok: false });
  });
});

describe("parseUpdateVariantBody", () => {
  it("distinguishes absent (unchanged) from null/blank (clear)", () => {
    expect(parseUpdateVariantBody({ name: "New" })).toEqual({ ok: true, input: { name: "New" } });
    expect(parseUpdateVariantBody({ size: "" })).toEqual({ ok: true, input: { size: null } });
    expect(parseUpdateVariantBody({ finishedGoodItemId: null })).toEqual({
      ok: true,
      input: { finishedGoodItemId: null },
    });
    expect(parseUpdateVariantBody({ finishedGoodItemId: UUID_B })).toEqual({
      ok: true,
      input: { finishedGoodItemId: UUID_B },
    });
  });

  it("rejects an empty body and a malformed finished-good item", () => {
    expect(parseUpdateVariantBody({})).toEqual({ ok: false });
    expect(parseUpdateVariantBody({ finishedGoodItemId: "nope" })).toEqual({ ok: false });
    expect(parseUpdateVariantBody(undefined)).toEqual({ ok: false });
  });
});

describe("parseRecipeAssignmentBody", () => {
  it("parses a date window and a null end", () => {
    const parsed = parseRecipeAssignmentBody({
      locationId: UUID_A,
      recipeVersionId: UUID_B,
      effectiveFrom: "2026-01-01",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.effectiveFrom.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(parsed.input.effectiveTo).toBeNull();
    }
  });

  it("rejects a missing id, a bad date and a window that ends before it starts", () => {
    expect(
      parseRecipeAssignmentBody({ recipeVersionId: UUID_B, effectiveFrom: "2026-01-01" }),
    ).toEqual({ ok: false });
    expect(
      parseRecipeAssignmentBody({
        locationId: UUID_A,
        recipeVersionId: UUID_B,
        effectiveFrom: "not-a-date",
      }),
    ).toEqual({ ok: false });
    expect(
      parseRecipeAssignmentBody({
        locationId: UUID_A,
        recipeVersionId: UUID_B,
        effectiveFrom: "2026-02-01",
        effectiveTo: "2026-01-01",
      }),
    ).toEqual({ ok: false });
  });
});

describe("parseAddonApplicabilityBody", () => {
  it("accepts an optional price effect and rejects a non-decimal one", () => {
    expect(parseAddonApplicabilityBody({ baseProductId: UUID_B })).toEqual({
      ok: true,
      input: { baseProductId: UUID_B, priceEffect: null },
    });
    expect(parseAddonApplicabilityBody({ baseProductId: UUID_B, priceEffect: "-5.5" })).toEqual({
      ok: true,
      input: { baseProductId: UUID_B, priceEffect: "-5.5" },
    });
    expect(parseAddonApplicabilityBody({ baseProductId: UUID_B, priceEffect: "1e3" })).toEqual({
      ok: false,
    });
  });
});

describe("row mappers", () => {
  it("maps a variant detail with ISO dates and resolved refs", () => {
    const row = toVariantDetailRow({
      variant: {
        id: "v1",
        organizationId: "org",
        productId: "p1",
        code: "V1",
        sku: "S1",
        name: "V1",
        size: null,
        finishedGoodItemId: null,
        activeFrom: "2026-01-01",
        activeTo: null,
      },
      product: { id: "p1", code: "CAKE", name: "Cake" },
      recipeAssignments: [
        {
          id: "a1",
          locationId: "l1",
          locationCode: "OSL",
          locationName: "Oslo",
          recipeVersionId: "rv1",
          recipeVersionNo: 3,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: null,
        },
      ],
      addonApplicability: [
        {
          id: "ad1",
          addon: { id: "p2", code: "SPR", name: "Sprinkles" },
          base: { id: "p1", code: "CAKE", name: "Cake" },
          priceEffect: "2.5",
          activeFrom: "2026-01-01",
          activeTo: null,
        },
      ],
    });

    expect(row.recipeAssignments[0]?.effectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(row.recipeAssignments[0]?.effectiveTo).toBeNull();
    expect(row.addonApplicability[0]?.addon.code).toBe("SPR");
  });

  it("maps a product list row with its variants", () => {
    const row = toProductWithVariantsRow({
      product: {
        id: "p1",
        organizationId: "org",
        code: "CAKE",
        name: "Cake",
        category: "Dessert",
        productKind: "base",
        activeFrom: "2026-01-01",
        activeTo: null,
      },
      variants: [],
    });
    expect(row.product.code).toBe("CAKE");
    expect(row.variants).toEqual([]);
  });
});
