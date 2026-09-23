import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { yieldRatio, yieldVariancePctFromTotals } from "./operational-reporting";
import { yieldVariancePct } from "./production";

describe("yieldVariancePctFromTotals", () => {
  it("is the fraction (actual − planned) / planned at 6 dp, negative on under-yield", () => {
    expect(yieldVariancePctFromTotals("100.000000", "95.000000")).toBe("-0.050000");
    expect(yieldVariancePctFromTotals("100.000000", "110.000000")).toBe("0.100000");
    expect(yieldVariancePctFromTotals("100.000000", "100.000000")).toBe("0.000000");
  });

  it("reuses the yieldVariancePct definition over the same inputs", () => {
    expect(yieldVariancePctFromTotals("80.000000", "60.000000")).toBe(
      yieldVariancePct("80.000000", "60.000000"),
    );
  });

  it("returns null when planned output is non-positive (undefined)", () => {
    expect(yieldVariancePctFromTotals("0.000000", "5.000000")).toBeNull();
    expect(yieldVariancePctFromTotals("-1.000000", "5.000000")).toBeNull();
  });

  it("rejects a malformed decimal", () => {
    expect(() => yieldVariancePctFromTotals("nope", "1")).toThrow(DomainError);
    expect(() => yieldVariancePctFromTotals("1", "-1.000000")).toThrow(DomainError);
  });
});

describe("yieldRatio", () => {
  it("is actual / planned at 6 dp", () => {
    expect(yieldRatio("100.000000", "95.000000")).toBe("0.950000");
    expect(yieldRatio("3.000000", "1.000000")).toBe("0.333333");
  });

  it("allows an over-yield above 1", () => {
    expect(yieldRatio("100.000000", "125.000000")).toBe("1.250000");
  });

  it("returns null when planned output is non-positive (undefined)", () => {
    expect(yieldRatio("0.000000", "5.000000")).toBeNull();
    expect(yieldRatio("-2.000000", "5.000000")).toBeNull();
  });

  it("rejects a malformed or negative output", () => {
    expect(() => yieldRatio("nope", "1")).toThrow(DomainError);
    expect(() => yieldRatio("1", "-1.000000")).toThrow(DomainError);
  });
});
