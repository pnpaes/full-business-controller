import { describe, expect, it } from "vitest";

import {
  assertNoSubRecipeCycles,
  assertRecipeVersionState,
  computeRecipeCost,
  isRecipeVersionEffectiveAt,
  lineCost,
  requiredPurchaseQuantity,
  selectEffectiveRecipeVersion,
  usableYieldRate,
} from "./recipe";

describe("usableYieldRate (CALCULATION_CONTRACT §6)", () => {
  it("derives approved_usable_output / planned_input at 6 dp", () => {
    expect(usableYieldRate("1.000000", "0.800000")).toBe("0.800000");
    expect(usableYieldRate("3.000000", "1.000000")).toBe("0.333333");
  });

  it("rejects a rate above 1 and non-positive inputs", () => {
    expect(() => usableYieldRate("1.000000", "1.500000")).toThrow(/must not exceed 1/);
    expect(() => usableYieldRate("0", "1.000000")).toThrow(/plannedInputQty must be positive/);
    expect(() => usableYieldRate("1.000000", "0")).toThrow(/approvedUsableOutput must be positive/);
  });
});

describe("requiredPurchaseQuantity (B0)", () => {
  it("applies per-line loss_factor then the recipe yield rate, rounded once", () => {
    // 0.1 / 0.9 = 0.111111...; / 0.8 = 0.138888... → 0.138889 at 6 dp.
    expect(requiredPurchaseQuantity("0.100000", "0.900000", "0.800000")).toBe("0.138889");
  });

  it("is exact when loss and yield are 1", () => {
    expect(requiredPurchaseQuantity("2.500000", "1.000000", "1.000000")).toBe("2.500000");
  });

  it("rounds HALF_UP at B0 when the 5th decimal decides", () => {
    // 1 / 0.999995 = 1.000005000025…; the 7th decimal is below the 6 dp half,
    // so the half-up step lands on 1.000005 (not 1.000006).
    expect(requiredPurchaseQuantity("1.000000", "0.999995", "1.000000")).toBe("1.000005");
    // …and a candidate just past the half rounds up.
    expect(requiredPurchaseQuantity("1.000006", "0.999995", "1.000000")).toBe("1.000011");
  });

  it("rejects a zero loss factor or yield rate (zero divisor)", () => {
    expect(() => requiredPurchaseQuantity("1.000000", "0", "1.000000")).toThrow(
      /lossFactor must be in/,
    );
    expect(() => requiredPurchaseQuantity("1.000000", "1.000000", "0")).toThrow(
      /usable yield rate must be in/,
    );
  });

  it("rejects an out-of-range loss factor or yield rate and zero quantity", () => {
    expect(() => requiredPurchaseQuantity("1", "1.200000", "1.000000")).toThrow(
      /lossFactor must be in/,
    );
    expect(() => requiredPurchaseQuantity("1", "1.000000", "1.200000")).toThrow(
      /usable yield rate must be in/,
    );
    expect(() => requiredPurchaseQuantity("0", "1.000000", "1.000000")).toThrow(
      /quantity must be positive/,
    );
  });
});

describe("lineCost (B2)", () => {
  it("multiplies the required quantity by the base-unit cost at 4 dp", () => {
    expect(lineCost("0.138889", "10.0000", "NOK")).toBe("1.3889");
  });

  it("rounds HALF_UP at the 4 dp boundary", () => {
    // 0.5 × 0.0001 = 0.00005 → 0.0001 (HALF_UP, not HALF_EVEN).
    expect(lineCost("0.500000", "0.0001", "NOK")).toBe("0.0001");
  });

  it("rounds HALF_UP at B2 when the 5th decimal decides", () => {
    // 1.000050 × 1.0000 = 1.000050 → 1.0001 (exact half rounds up).
    expect(lineCost("1.000050", "1.0000", "NOK")).toBe("1.0001");
    // 1.000049 × 1.0000 = 1.000049 → 1.0000 (just below the half).
    expect(lineCost("1.000049", "1.0000", "NOK")).toBe("1.0000");
    // 0.000051 × 1.0000 = 0.000051 → 0.0001 (just above the half).
    expect(lineCost("0.000051", "1.0000", "NOK")).toBe("0.0001");
  });

  it("rejects a negative base-unit cost", () => {
    expect(() => lineCost("1.000000", "-1.0000", "NOK")).toThrow(/must not be negative/);
  });
});

describe("computeRecipeCost (B3)", () => {
  it("sums line costs and divides by the approved usable output", () => {
    const cost = computeRecipeCost({
      currency: "NOK",
      lines: [{ lineCost: "10.0000" }, { lineCost: "2.5000" }],
      approvedUsableOutput: "5.000000",
      directBatchLabor: "1.0000",
      batchVariableCost: "0.5000",
    });
    expect(cost.recipeInputCost).toBe("12.5000");
    expect(cost.recipeOutputCost).toBe("14.0000");
    expect(cost.costPerUsableOutputUnit).toBe("2.8000");
  });

  it("defaults labor and variable cost to zero (slice 5 excludes labour)", () => {
    const cost = computeRecipeCost({
      currency: "NOK",
      lines: [{ lineCost: "3.0000" }],
      approvedUsableOutput: "2.000000",
    });
    expect(cost.recipeOutputCost).toBe("3.0000");
    expect(cost.costPerUsableOutputUnit).toBe("1.5000");
  });

  it("rounds HALF_UP at B3 and rejects a non-positive output", () => {
    const tie = computeRecipeCost({
      currency: "NOK",
      lines: [{ lineCost: "0.0001" }],
      approvedUsableOutput: "2.000000",
    });
    expect(tie.costPerUsableOutputUnit).toBe("0.0001");
    expect(() =>
      computeRecipeCost({ currency: "NOK", lines: [], approvedUsableOutput: "0" }),
    ).toThrow(/approvedUsableOutput must be positive/);
  });

  it("rounds HALF_UP at B3 when the 5th decimal decides", () => {
    const perUnit = (lineCost: string) =>
      computeRecipeCost({
        currency: "NOK",
        lines: [{ lineCost }],
        approvedUsableOutput: "0.800000",
      }).costPerUsableOutputUnit;
    // 0.0002 / 0.8 = 0.00025 → 0.0003 (exact half rounds up).
    expect(perUnit("0.0002")).toBe("0.0003");
    // 0.0001 / 0.8 = 0.000125 → 0.0001 (just below the half).
    expect(perUnit("0.0001")).toBe("0.0001");
    // 0.0003 / 0.8 = 0.000375 → 0.0004 (just above the half).
    expect(perUnit("0.0003")).toBe("0.0004");
  });
});

describe("sub-recipe cycles (COST-002)", () => {
  it("accepts a DAG and rejects a direct self-reference", () => {
    expect(() =>
      assertNoSubRecipeCycles([
        { parentRecipeId: "a", childRecipeId: "b" },
        { parentRecipeId: "b", childRecipeId: "c" },
      ]),
    ).not.toThrow();
    expect(() => assertNoSubRecipeCycles([{ parentRecipeId: "a", childRecipeId: "a" }])).toThrow(
      /must not contain itself/,
    );
  });

  it("rejects a transitive cycle", () => {
    expect(() =>
      assertNoSubRecipeCycles([
        { parentRecipeId: "a", childRecipeId: "b" },
        { parentRecipeId: "b", childRecipeId: "c" },
        { parentRecipeId: "c", childRecipeId: "a" },
      ]),
    ).toThrow(/circular sub-recipes/);
  });
});

describe("recipe version effective dating", () => {
  const asOf = (iso: string) => new Date(iso);

  it("treats windows as half-open [from, to)", () => {
    const version = {
      effectiveFrom: asOf("2026-01-01T00:00:00Z"),
      effectiveTo: asOf("2026-02-01T00:00:00Z"),
    };
    expect(isRecipeVersionEffectiveAt(version, asOf("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isRecipeVersionEffectiveAt(version, asOf("2026-01-31T23:59:59Z"))).toBe(true);
    expect(isRecipeVersionEffectiveAt(version, asOf("2026-02-01T00:00:00Z"))).toBe(false);
  });

  it("selects the single effective version and returns undefined when none", () => {
    const versions = [{ id: "v1", effectiveFrom: asOf("2026-01-01T00:00:00Z"), effectiveTo: null }];
    expect(selectEffectiveRecipeVersion(versions, asOf("2026-06-01T00:00:00Z"))?.id).toBe("v1");
    expect(selectEffectiveRecipeVersion(versions, asOf("2025-12-31T00:00:00Z"))).toBeUndefined();
  });

  it("throws rather than guessing when windows overlap", () => {
    const versions = [
      { effectiveFrom: asOf("2026-01-01T00:00:00Z"), effectiveTo: null },
      { effectiveFrom: asOf("2026-01-01T00:00:00Z"), effectiveTo: null },
    ];
    expect(() => selectEffectiveRecipeVersion(versions, asOf("2026-06-01T00:00:00Z"))).toThrow(
      /more than one recipe version/,
    );
  });
});

describe("recipe version state", () => {
  it("requires an approver for an approved state", () => {
    expect(() => assertRecipeVersionState("approved", "user-1")).not.toThrow();
    expect(() => assertRecipeVersionState("approved", null)).toThrow(/requires an approver/);
    expect(() => assertRecipeVersionState("draft")).not.toThrow();
    expect(() => assertRecipeVersionState("bogus")).toThrow(/unknown recipe version state/);
  });
});
