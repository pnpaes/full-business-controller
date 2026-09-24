import { describe, expect, it } from "vitest";

import {
  belowFraction,
  difference,
  directionFor,
  formatModelValue,
  linearFit,
  meanAbsolutePercentageError,
  ratio,
  relativeChange,
  toNumber,
} from "./math";

describe("difference", () => {
  it("subtracts exact decimal strings at the metric scale", () => {
    expect(difference("120.0000", "100.0000", 4)).toBe("20.0000");
    expect(difference("90.0000", "120.0000", 4)).toBe("-30.0000");
  });
});

describe("ratio", () => {
  it("divides as a fraction at the target scale", () => {
    expect(ratio("50.0000", "200.0000", 4, 6)).toBe("0.250000");
    expect(ratio("300.0000", "600.0000", 4, 6)).toBe("0.500000");
  });

  it("returns null when the denominator is zero", () => {
    expect(ratio("50.0000", "0.0000", 4, 6)).toBeNull();
  });
});

describe("relativeChange", () => {
  it("computes a signed fraction against the previous value", () => {
    expect(relativeChange("120.0000", "100.0000", 4, 6)).toBe("0.200000");
    expect(relativeChange("90.0000", "120.0000", 4, 6)).toBe("-0.250000");
  });

  it("returns null when the previous value is zero", () => {
    expect(relativeChange("10.0000", "0.0000", 4, 6)).toBeNull();
  });
});

describe("directionFor", () => {
  it("reads flat within the band and the sign outside it", () => {
    expect(directionFor("2.0000", "0.020000", 4, "0.050000", 6)).toBe("flat");
    expect(directionFor("6.0000", "0.060000", 4, "0.050000", 6)).toBe("up");
    expect(directionFor("-6.0000", "-0.060000", 4, "0.050000", 6)).toBe("down");
    expect(directionFor("-5.0000", "-0.050000", 4, "0.050000", 6)).toBe("flat");
  });

  it("falls back to the absolute sign when the relative change is undefined", () => {
    expect(directionFor("10.0000", null, 4, "0.050000", 6)).toBe("up");
    expect(directionFor("-10.0000", null, 4, "0.050000", 6)).toBe("down");
    expect(directionFor("0.0000", null, 4, "0.050000", 6)).toBe("flat");
  });
});

describe("belowFraction", () => {
  it("is true strictly below 1 − threshold", () => {
    expect(belowFraction("0.700000", "0.250000", 6)).toBe(true);
    expect(belowFraction("0.750000", "0.250000", 6)).toBe(false);
    expect(belowFraction("0.900000", "0.250000", 6)).toBe(false);
  });
});

describe("formatModelValue", () => {
  it("rounds a model value to the metric scale as a decimal string", () => {
    expect(formatModelValue(139.99995, 4)).toBe("140.0000");
    expect(formatModelValue(-0.05, 4)).toBe("-0.0500");
    expect(formatModelValue(0.1234567, 6)).toBe("0.123457");
  });
});

describe("linearFit", () => {
  it("fits a perfect line with zero residuals", () => {
    const fit = linearFit([100, 110, 120, 130]);
    expect(fit.slope).toBeCloseTo(10, 10);
    expect(fit.intercept).toBeCloseTo(100, 10);
    expect(fit.residualStdDev).toBeCloseTo(0, 10);
  });

  it("reports a residual standard deviation for a noisy series", () => {
    const fit = linearFit([100, 120, 110, 140]);
    expect(fit.residualStdDev).not.toBeNull();
    expect(fit.residualStdDev!).toBeGreaterThan(0);
  });

  it("has no residual degrees of freedom below three points", () => {
    expect(linearFit([100, 200]).residualStdDev).toBeNull();
  });
});

describe("meanAbsolutePercentageError", () => {
  it("is zero for a perfect fit and positive otherwise", () => {
    expect(meanAbsolutePercentageError([100, 110], [100, 110])).toBeCloseTo(0, 10);
    expect(meanAbsolutePercentageError([100, 110], [100, 121])).toBeCloseTo(0.05, 10);
  });

  it("is null when every actual is zero", () => {
    expect(meanAbsolutePercentageError([0, 0], [1, 2])).toBeNull();
  });
});

describe("toNumber", () => {
  it("parses a decimal string and rejects a non-numeric one", () => {
    expect(toNumber("0.950000")).toBeCloseTo(0.95, 10);
    expect(() => toNumber("not-a-number")).toThrow();
  });
});
