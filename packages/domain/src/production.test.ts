import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { outputUnitCost, scaleQuantityByRatio, yieldRate, yieldVariancePct } from "./production";

describe("yieldRate", () => {
  it("derives the actual output/input ratio at 6 dp", () => {
    expect(yieldRate("900", "1000")).toBe("0.900000");
    expect(yieldRate("1000", "1000")).toBe("1.000000");
  });

  it("rounds HALF_UP once at 6 dp", () => {
    expect(yieldRate("2", "3")).toBe("0.666667");
    expect(yieldRate("1", "8")).toBe("0.125000");
  });

  it("allows an actual over-yield above 1 (unlike the plan-time usableYieldRate)", () => {
    expect(yieldRate("1100", "1000")).toBe("1.100000");
  });

  it("rejects a non-positive input and a negative output", () => {
    expect(() => yieldRate("1", "0")).toThrow(DomainError);
    expect(() => yieldRate("1", "0")).toThrow(/inputQty must be positive/);
    expect(() => yieldRate("1", "-1")).toThrow(/inputQty must be positive/);
    expect(() => yieldRate("-1", "1")).toThrow(/outputQty must not be negative/);
  });
});

describe("yieldVariancePct", () => {
  it("returns a signed fraction (not a percentage) at 6 dp", () => {
    expect(yieldVariancePct("10", "9.5")).toBe("-0.050000");
    expect(yieldVariancePct("10", "10")).toBe("0.000000");
    expect(yieldVariancePct("10", "11")).toBe("0.100000");
  });

  it("rounds HALF_UP once at 6 dp", () => {
    expect(yieldVariancePct("3", "2")).toBe("-0.333333");
  });

  it("rejects a non-positive planned output and a negative actual", () => {
    expect(() => yieldVariancePct("0", "1")).toThrow(/plannedOutput must be positive/);
    expect(() => yieldVariancePct("-1", "1")).toThrow(/plannedOutput must be positive/);
    expect(() => yieldVariancePct("1", "-1")).toThrow(/actualOutput must not be negative/);
  });
});

describe("outputUnitCost", () => {
  it("divides the batch input value by the usable output at 4 dp (B3)", () => {
    expect(outputUnitCost("10.0000", "3.000000")).toBe("3.3333");
    expect(outputUnitCost("48.0000", "12.000000")).toBe("4.0000");
    expect(outputUnitCost("0.0000", "5.000000")).toBe("0.0000");
  });

  it("rounds HALF_UP once at 4 dp", () => {
    expect(outputUnitCost("10.0000", "6.000000")).toBe("1.6667");
    expect(outputUnitCost("2.0000", "3.000000")).toBe("0.6667");
  });

  it("rejects a zero or negative usable output (CALCULATION_CONTRACT §12.2)", () => {
    expect(() => outputUnitCost("1.0000", "0")).toThrow(DomainError);
    expect(() => outputUnitCost("1.0000", "0")).toThrow(/usableOutputQty must be positive/);
    expect(() => outputUnitCost("1.0000", "-1")).toThrow(/usableOutputQty must be positive/);
  });

  it("rejects a negative input cost", () => {
    expect(() => outputUnitCost("-1.0000", "1")).toThrow(/inputCost must not be negative/);
  });
});

describe("scaleQuantityByRatio (DEC-125)", () => {
  it("scales by numerator / denominator, rounding once at B0", () => {
    expect(scaleQuantityByRatio("0.500000", "60.000000", "1.000000")).toBe("30.000000");
    // 0.500000 × 0.333333 / 1.000000 = 0.1666665 → HALF_UP → 0.166667.
    expect(scaleQuantityByRatio("0.500000", "0.333333", "1.000000")).toBe("0.166667");
    // The ratio cancels: a version's planned output scaled to itself is exact.
    expect(scaleQuantityByRatio("4.000000", "4.000000", "4.000000")).toBe("4.000000");
  });

  it("never rounds the intermediate product", () => {
    // 1/3 of 3 exactly = 1: a two-step (factor then multiply) would drift.
    expect(scaleQuantityByRatio("3.000000", "1.000000", "3.000000")).toBe("1.000000");
    expect(scaleQuantityByRatio("1.000000", "1.000000", "3.000000")).toBe("0.333333");
  });

  it("rejects a non-positive denominator and a negative numerator", () => {
    expect(() => scaleQuantityByRatio("1.000000", "1.000000", "0")).toThrow(
      /denominator must be positive/,
    );
    expect(() => scaleQuantityByRatio("1.000000", "-1.000000", "1.000000")).toThrow(
      /numerator must not be negative/,
    );
    expect(() => scaleQuantityByRatio("-1.000000", "1.000000", "1.000000")).toThrow(
      /quantity must not be negative/,
    );
  });
});
