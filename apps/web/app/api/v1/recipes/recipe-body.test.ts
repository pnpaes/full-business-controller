import { describe, expect, it } from "vitest";

import { parseRegisterRecipeBody, parseRegisterVersionBody } from "./recipe-body";

const ITEM = "3bece9e8-ee3d-41e5-b340-dacba03c7855";
const UNIT = "4d3d9ae8-4113-406e-9804-9175ea27e777";
const ALLERGEN = "6f85c3c4-1313-4794-9172-552a0faa0b88";

describe("parseRegisterRecipeBody", () => {
  it("accepts code and name with no output item", () => {
    expect(parseRegisterRecipeBody({ code: "DOUGH", name: "Pizza Dough" })).toEqual({
      ok: true,
      value: { code: "DOUGH", name: "Pizza Dough" },
    });
  });

  it("accepts an explicit null output item and a UUID", () => {
    expect(parseRegisterRecipeBody({ code: "D", name: "D", outputItemId: null })).toEqual({
      ok: true,
      value: { code: "D", name: "D", outputItemId: null },
    });
    expect(parseRegisterRecipeBody({ code: "D", name: "D", outputItemId: ITEM })).toEqual({
      ok: true,
      value: { code: "D", name: "D", outputItemId: ITEM },
    });
  });

  it("rejects a missing name or a malformed output item", () => {
    expect(parseRegisterRecipeBody({ code: "D" })).toEqual({ ok: false });
    expect(parseRegisterRecipeBody({ code: "D", name: "D", outputItemId: "nope" })).toEqual({
      ok: false,
    });
    expect(parseRegisterRecipeBody(undefined)).toEqual({ ok: false });
  });
});

describe("parseRegisterVersionBody", () => {
  const minimal = {
    versionNo: 1,
    plannedInputQty: "1.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: "0.800000",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    lines: [{ componentKind: "ingredient", itemId: ITEM, quantity: "0.800000", unitId: UNIT }],
  };

  it("parses a minimal version and converts effectiveFrom to a Date", () => {
    const result = parseRegisterVersionBody(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.versionNo).toBe(1);
      expect(result.value.effectiveFrom.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(result.value.lines).toHaveLength(1);
    }
  });

  it("parses optional fields, a sub-recipe line and allergens", () => {
    const result = parseRegisterVersionBody({
      ...minimal,
      state: "approved",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      preparationMinutes: 12,
      notes: "noted",
      lines: [
        { componentKind: "sub_recipe", subRecipeId: ITEM, quantity: "0.300000", unitId: UNIT },
        { componentKind: "packaging", itemId: ITEM, quantity: "1.000000", unitId: UNIT },
      ],
      allergens: [{ allergenId: ALLERGEN, source: "verified", verifiedBy: ITEM }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("approved");
      expect(result.value.preparationMinutes).toBe(12);
      expect(result.value.allergens).toEqual([
        { allergenId: ALLERGEN, source: "verified", verifiedBy: ITEM },
      ]);
    }
  });

  it("parses the DEC-112 direct-labour mapping, allowing explicit nulls", () => {
    const mapped = parseRegisterVersionBody({
      ...minimal,
      laborCostCenterId: ITEM,
      laborRoleCode: "kitchen",
    });
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.value.laborCostCenterId).toBe(ITEM);
      expect(mapped.value.laborRoleCode).toBe("kitchen");
    }

    const cleared = parseRegisterVersionBody({
      ...minimal,
      laborCostCenterId: null,
      laborRoleCode: null,
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.laborCostCenterId).toBeNull();
      expect(cleared.value.laborRoleCode).toBeNull();
    }
  });

  it("rejects a malformed direct-labour mapping", () => {
    expect(parseRegisterVersionBody({ ...minimal, laborCostCenterId: "nope" })).toEqual({
      ok: false,
    });
    expect(parseRegisterVersionBody({ ...minimal, laborRoleCode: 7 })).toEqual({ ok: false });
  });

  it("rejects a missing line array, a bad version number and a malformed line id", () => {
    expect(parseRegisterVersionBody({ ...minimal, lines: [] })).toEqual({ ok: false });
    expect(parseRegisterVersionBody({ ...minimal, versionNo: 0 })).toEqual({ ok: false });
    expect(
      parseRegisterVersionBody({
        ...minimal,
        lines: [{ componentKind: "ingredient", itemId: "nope", quantity: "1", unitId: UNIT }],
      }),
    ).toEqual({ ok: false });
  });

  it("rejects a missing effectiveFrom and a non-array allergens field", () => {
    expect(parseRegisterVersionBody({ ...minimal, effectiveFrom: undefined })).toEqual({
      ok: false,
    });
    expect(parseRegisterVersionBody({ ...minimal, allergens: { allergenId: ALLERGEN } })).toEqual({
      ok: false,
    });
  });
});
