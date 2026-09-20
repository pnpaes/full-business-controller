import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  applyStockMovement,
  applyStockMovementValue,
  computeMovementValue,
  deriveAverageUnitCost,
  recomputeStockBalance,
  reverseStockMovement,
  revaluationGap,
  wouldDriveNegative,
  type StockBalanceSnapshot,
} from "./stock";

const empty: StockBalanceSnapshot = {
  quantityOnHand: "0.000000",
  valueOnHand: "0.0000",
  avgUnitCost: null,
};

describe("wouldDriveNegative", () => {
  it("is true when the delta exceeds the quantity on hand", () => {
    expect(wouldDriveNegative("5.000000", "-6.000000")).toBe(true);
  });

  it("is false when the result stays non-negative", () => {
    expect(wouldDriveNegative("5.000000", "-4.000000")).toBe(false);
  });

  it("is false at exactly zero", () => {
    expect(wouldDriveNegative("5.000000", "-5.000000")).toBe(false);
  });
});

describe("computeMovementValue", () => {
  it("values an inbound at its unit cost", () => {
    expect(
      computeMovementValue({ quantityDelta: "10.000000", unitCost: "5.0000", avgUnitCost: null }),
    ).toBe("50.0000");
  });

  it("values an outbound at the balance average", () => {
    expect(computeMovementValue({ quantityDelta: "-2.000000", avgUnitCost: "6.0000" })).toBe(
      "-12.0000",
    );
  });

  it("values an outbound at zero when no average exists yet (override path)", () => {
    expect(computeMovementValue({ quantityDelta: "-1.000000", avgUnitCost: null })).toBe("0.0000");
  });

  it("rounds the value HALF_UP at the 4th decimal", () => {
    // 0.0001 × 0.5 = 0.00005; the 5th decimal is an exact half, so it rounds
    // away from zero to 0.0001 (pins the equality path in divideRoundHalfUp).
    expect(
      computeMovementValue({ quantityDelta: "0.500000", unitCost: "0.0001", avgUnitCost: null }),
    ).toBe("0.0001");
  });

  it("throws on a zero quantity delta", () => {
    expect(() =>
      computeMovementValue({ quantityDelta: "0.000000", unitCost: "1", avgUnitCost: null }),
    ).toThrow(DomainError);
    expect(() =>
      computeMovementValue({ quantityDelta: "0.000000", unitCost: "1", avgUnitCost: null }),
    ).toThrow(/must not be zero/);
  });

  it("throws on a negative unit cost", () => {
    expect(() =>
      computeMovementValue({ quantityDelta: "1.000000", unitCost: "-1", avgUnitCost: null }),
    ).toThrow(/must not be negative/);
  });

  it("throws when an inbound omits its unit cost", () => {
    expect(() =>
      computeMovementValue({ quantityDelta: "1.000000", unitCost: null, avgUnitCost: "5" }),
    ).toThrow(/requires a unit cost/);
    expect(() => computeMovementValue({ quantityDelta: "1.000000", avgUnitCost: "5" })).toThrow(
      DomainError,
    );
  });
});

describe("deriveAverageUnitCost", () => {
  it("returns null when the quantity on hand is zero", () => {
    expect(deriveAverageUnitCost("0.000000", "5.0000")).toBeNull();
  });

  it("divides value by quantity exactly", () => {
    expect(deriveAverageUnitCost("10.000000", "50.0000")).toBe("5.0000");
  });

  it("rounds the average HALF_UP at the 4th decimal", () => {
    // 0.0001 × 10^6 / 2,000,000 = 0.5, an exact half that rounds up to 1.
    expect(deriveAverageUnitCost("2.000000", "0.0001")).toBe("0.0001");
  });
});

describe("applyStockMovement", () => {
  it("sets the average on the first inbound", () => {
    const result = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    expect(result).toEqual({
      quantityOnHand: "10.000000",
      valueOnHand: "50.0000",
      avgUnitCost: "5.0000",
      valueDelta: "50.0000",
      unitCostApplied: "5.0000",
    });
  });

  it("produces the weighted average on a second inbound at a different cost", () => {
    const first = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    const second = applyStockMovement(first, { quantityDelta: "5.000000", unitCost: "8.0000" });
    // (10 × 5 + 5 × 8) / 15 = 90 / 15 = 6
    expect(second.valueDelta).toBe("40.0000");
    expect(second.valueOnHand).toBe("90.0000");
    expect(second.avgUnitCost).toBe("6.0000");
    expect(second.unitCostApplied).toBe("8.0000");
  });

  it("keeps the average unchanged on an outbound and posts avg × qty", () => {
    const first = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    const second = applyStockMovement(first, { quantityDelta: "-2.000000" });
    expect(second.valueDelta).toBe("-10.0000");
    expect(second.valueOnHand).toBe("40.0000");
    expect(second.quantityOnHand).toBe("8.000000");
    expect(second.avgUnitCost).toBe("5.0000");
    expect(second.unitCostApplied).toBe("5.0000");
  });

  it("posts zero value for an outbound before any inbound and does not throw", () => {
    const result = applyStockMovement(empty, { quantityDelta: "-1.000000" });
    expect(result.valueDelta).toBe("0.0000");
    expect(result.quantityOnHand).toBe("-1.000000");
    expect(result.valueOnHand).toBe("0.0000");
    expect(result.avgUnitCost).toBe("0.0000");
    expect(result.unitCostApplied).toBe("0.0000");
  });

  it("rounds the derived average HALF_UP at the 4th decimal", () => {
    // 1 unit at 0.0001 then 1 unit at 0: value 0.0001 over qty 2 =>
    // 0.0001 × 10^6 / 2,000,000 = 0.5, an exact half that rounds up to 1.
    const first = applyStockMovement(empty, { quantityDelta: "1.000000", unitCost: "0.0001" });
    const second = applyStockMovement(first, { quantityDelta: "1.000000", unitCost: "0.0000" });
    expect(second.valueOnHand).toBe("0.0001");
    expect(second.avgUnitCost).toBe("0.0001");
  });

  it("clears the average to null when the movement returns quantity to zero", () => {
    const first = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    const out = applyStockMovement(first, { quantityDelta: "-10.000000" });
    expect(out.quantityOnHand).toBe("0.000000");
    expect(out.valueOnHand).toBe("0.0000");
    expect(out.avgUnitCost).toBeNull();
  });

  it("does not throw when a movement drives quantity negative (override guard is the caller's)", () => {
    const first = applyStockMovement(empty, { quantityDelta: "1.000000", unitCost: "2.0000" });
    const out = applyStockMovement(first, { quantityDelta: "-3.000000" });
    expect(out.quantityOnHand).toBe("-2.000000");
    expect(out.valueDelta).toBe("-6.0000");
  });
});

describe("applyStockMovementValue", () => {
  it("sums an explicit quantity/value delta and derives the average", () => {
    const result = applyStockMovementValue(
      { quantityOnHand: "10.000000", valueOnHand: "50.0000", avgUnitCost: "5.0000" },
      { quantityDelta: "10.000000", valueDelta: "90.0000" },
    );
    expect(result).toEqual({
      quantityOnHand: "20.000000",
      valueOnHand: "140.0000",
      avgUnitCost: "7.0000",
    });
  });

  it("uses the value delta verbatim instead of recomputing at the current average", () => {
    // The balance average says 10.0000, but the explicit -40.0000 is applied as
    // posted (a reversal/value correction), not as -10 × 10.
    const result = applyStockMovementValue(
      { quantityOnHand: "10.000000", valueOnHand: "100.0000", avgUnitCost: "10.0000" },
      { quantityDelta: "-10.000000", valueDelta: "-40.0000" },
    );
    expect(result).toEqual({
      quantityOnHand: "0.000000",
      valueOnHand: "60.0000",
      avgUnitCost: null,
    });
  });

  it("returns the pre-receipt balance when the exact reversal is applied", () => {
    const receipt = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    const restored = applyStockMovementValue(receipt, {
      quantityDelta: "-10.000000",
      valueDelta: "-50.0000",
    });
    expect(restored).toEqual(empty);
  });
});

describe("reverseStockMovement", () => {
  it("negates quantity and value exactly", () => {
    expect(reverseStockMovement({ quantityDelta: "2.500000", valueDelta: "12.3456" })).toEqual({
      quantityDelta: "-2.500000",
      valueDelta: "-12.3456",
    });
  });

  it("does not recompute at the current cost", () => {
    // The original outbound retained 6.0000; a reversal restores that value even
    // though a later receipt raised the average.
    const reversal = reverseStockMovement({ quantityDelta: "-2.000000", valueDelta: "-12.0000" });
    expect(reversal).toEqual({ quantityDelta: "2.000000", valueDelta: "12.0000" });
  });
});

describe("recomputeStockBalance", () => {
  it("is a zero balance for empty history", () => {
    expect(recomputeStockBalance([])).toEqual({
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
    });
  });

  it("matches the sequential apply result for a receipt plus consumption", () => {
    const receipt = applyStockMovement(empty, { quantityDelta: "10.000000", unitCost: "5.0000" });
    const consumption = applyStockMovement(receipt, { quantityDelta: "-2.000000" });

    const rebuilt = recomputeStockBalance([
      { quantityDelta: "10.000000", valueDelta: receipt.valueDelta },
      { quantityDelta: "-2.000000", valueDelta: consumption.valueDelta },
    ]);

    expect(rebuilt).toEqual({
      quantityOnHand: consumption.quantityOnHand,
      valueOnHand: consumption.valueOnHand,
      avgUnitCost: consumption.avgUnitCost,
    });
  });

  it("rounds the derived average HALF_UP", () => {
    // 0.0001 over qty 2: 0.0001 × 10^6 / 2,000,000 = 0.5 -> 0.0001.
    expect(recomputeStockBalance([{ quantityDelta: "2.000000", valueDelta: "0.0001" }])).toEqual({
      quantityOnHand: "2.000000",
      valueOnHand: "0.0001",
      avgUnitCost: "0.0001",
    });
  });
});

describe("revaluationGap", () => {
  it("returns the clearing delta when quantity is zero but value remains", () => {
    expect(
      revaluationGap({ quantityOnHand: "0.000000", valueOnHand: "5.0000", avgUnitCost: null }),
    ).toBe("-5.0000");
  });

  it("returns null when the balance is clean", () => {
    expect(
      revaluationGap({ quantityOnHand: "0.000000", valueOnHand: "0.0000", avgUnitCost: null }),
    ).toBeNull();
    expect(
      revaluationGap({ quantityOnHand: "3.000000", valueOnHand: "5.0000", avgUnitCost: "1.6667" }),
    ).toBeNull();
  });
});
