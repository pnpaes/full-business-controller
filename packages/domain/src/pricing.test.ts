import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  breakEvenUnits,
  channelVariableCost,
  contributionMarginPct,
  grossFromNet,
  includedTax,
  isEffectiveAt,
  netFromGross,
  perUnitFixedFee,
  presentedMoney,
  priceVersionWindowsOverlap,
  requiredNetPrice,
  selectEffectivePriceVersion,
  unitContribution,
  unitNetSales,
  unitVariableCost,
} from "./pricing";

describe("netFromGross / grossFromNet / includedTax", () => {
  it("computes the cheese_bun golden fixture net (15% inclusive)", () => {
    // 39.00 / 1.15 = 33.913043… → 33.9130.
    expect(netFromGross("39.00", "0.150000")).toBe("33.9130");
  });

  it("inverts the inclusive conversion", () => {
    expect(grossFromNet("33.9130", "0.150000")).toBe("39.0000");
  });

  it("is the identity at a zero rate", () => {
    expect(netFromGross("39.00", "0")).toBe("39.0000");
    expect(grossFromNet("39.00", "0")).toBe("39.0000");
    expect(includedTax("39.00", "0")).toBe("0.0000");
  });

  it("extracts the included tax as gross minus net", () => {
    expect(includedTax("39.00", "0.150000")).toBe("5.0870");
  });

  it("rejects a negative tax rate", () => {
    expect(() => netFromGross("39.00", "-0.01")).toThrow(/taxRate must not be negative/);
    expect(() => grossFromNet("39.00", "-0.01")).toThrow(/taxRate must not be negative/);
  });
});

describe("presentedMoney", () => {
  it("presents the golden net at 2 dp (B4)", () => {
    expect(presentedMoney("33.9130")).toBe("33.91");
  });

  it("rounds HALF_UP at 2 dp", () => {
    expect(presentedMoney("33.9150")).toBe("33.92");
    expect(presentedMoney("-33.9150")).toBe("-33.92");
  });
});

describe("unitNetSales", () => {
  it("uses the inclusive basis (gross − included tax)", () => {
    expect(
      unitNetSales({
        grossSales: "39.00",
        taxBasis: "inclusive",
        taxRate: "0.150000",
        discount: "1.0000",
        refund: "0.5000",
      }),
    ).toBe("32.4130");
  });

  it("uses the exclusive basis (gross is already net)", () => {
    expect(
      unitNetSales({
        grossSales: "39.00",
        taxBasis: "exclusive",
        taxRate: "0.150000",
        discount: "1.0000",
        refund: "0.5000",
      }),
    ).toBe("37.5000");
  });

  it("defaults discount and refund to zero", () => {
    expect(unitNetSales({ grossSales: "39.00", taxBasis: "exclusive", taxRate: "0" })).toBe(
      "39.0000",
    );
  });

  it("rejects a negative discount or refund", () => {
    expect(() =>
      unitNetSales({ grossSales: "39.00", taxBasis: "exclusive", taxRate: "0", discount: "-1" }),
    ).toThrow(/discount must not be negative/);
    expect(() =>
      unitNetSales({ grossSales: "39.00", taxBasis: "exclusive", taxRate: "0", refund: "-1" }),
    ).toThrow(/refund must not be negative/);
  });

  it("rejects an unknown tax basis", () => {
    expect(() =>
      unitNetSales({ grossSales: "39.00", taxBasis: "gross" as never, taxRate: "0" }),
    ).toThrow(/unknown taxBasis "gross"/);
  });
});

describe("channelVariableCost", () => {
  it("computes the cheese_bun golden fixture fee (30% of the net price)", () => {
    expect(channelVariableCost({ percentageFeeRate: "0.300000", feeBasisAmount: "53.9130" })).toBe(
      "16.1739",
    );
  });

  it("adds a fixed per-unit order fee", () => {
    expect(
      channelVariableCost({
        percentageFeeRate: "0.300000",
        feeBasisAmount: "53.9130",
        fixedOrderFeePerUnit: "1.5000",
      }),
    ).toBe("17.6739");
  });

  it("is zero for a zero rate and basis", () => {
    expect(channelVariableCost({ percentageFeeRate: "0", feeBasisAmount: "0" })).toBe("0.0000");
  });

  it("rejects a negative fee rate, basis or fixed fee", () => {
    expect(() => channelVariableCost({ percentageFeeRate: "-0.1", feeBasisAmount: "1" })).toThrow(
      /percentageFeeRate must not be negative/,
    );
    expect(() => channelVariableCost({ percentageFeeRate: "0.1", feeBasisAmount: "-1" })).toThrow(
      /feeBasisAmount must not be negative/,
    );
    expect(() =>
      channelVariableCost({
        percentageFeeRate: "0.1",
        feeBasisAmount: "1",
        fixedOrderFeePerUnit: "-1",
      }),
    ).toThrow(/fixedOrderFeePerUnit must not be negative/);
  });
});

describe("perUnitFixedFee", () => {
  it("allocates a fixed per-order fee across the order units (DEC-112)", () => {
    // Derivation (worked example): f = 120000 (12.0000), u = 8000000 (8 units).
    //   value         = (f/10^4)/(u/10^6) = f·10^2/u = 1.5
    //   result_scaled = 10^4 × value = f·10^6/u = 15000 → "1.5000".
    expect(perUnitFixedFee("12.0000", "8.000000")).toBe("1.5000");
  });

  it("rounds HALF_UP at 4 dp", () => {
    // 10/6 = 1.6666… → 1.6667.
    expect(perUnitFixedFee("10.0000", "6.000000")).toBe("1.6667");
  });

  it("rounds an exact half up", () => {
    // 100.0004/8 = 12.50005 → 12.5001 (the scaled remainder is exactly half).
    expect(perUnitFixedFee("100.0004", "8.000000")).toBe("12.5001");
  });

  it("is zero for a zero fixed amount", () => {
    expect(perUnitFixedFee("0", "8.000000")).toBe("0.0000");
  });

  it("rejects a negative fixed amount", () => {
    expect(() => perUnitFixedFee("-1", "8.000000")).toThrow(/fixedAmount must not be negative/);
  });

  it("rejects a non-positive units per order (never divides silently, §12.6)", () => {
    expect(() => perUnitFixedFee("12.0000", "0")).toThrow(/unitsPerOrder must be positive/);
    expect(() => perUnitFixedFee("12.0000", "-1")).toThrow(DomainError);
  });
});

describe("unitVariableCost", () => {
  it("sums the variable cost components at 4 dp", () => {
    expect(
      unitVariableCost({
        ingredientCost: "5.8800",
        packagingCost: "0.9000",
        channelVariableCost: "0",
        otherVariableCost: "0",
      }),
    ).toBe("6.7800");
  });

  it("includes the channel and other components", () => {
    expect(
      unitVariableCost({
        ingredientCost: "5.8800",
        packagingCost: "0.9000",
        channelVariableCost: "16.1739",
        otherVariableCost: "0.5000",
      }),
    ).toBe("23.4539");
  });

  it("rejects a negative component", () => {
    expect(() =>
      unitVariableCost({
        ingredientCost: "-1",
        packagingCost: "0",
        channelVariableCost: "0",
        otherVariableCost: "0",
      }),
    ).toThrow(/ingredientCost must not be negative/);
  });
});

describe("unitContribution", () => {
  it("subtracts the variable cost from net sales at 4 dp", () => {
    expect(unitContribution("33.9130", "9.3348")).toBe("24.5782");
  });

  it("allows a negative contribution", () => {
    expect(unitContribution("5.0000", "9.3348")).toBe("-4.3348");
  });

  it("rejects a negative variable cost", () => {
    expect(() => unitContribution("33.9130", "-1")).toThrow(
      /unitVariableCost must not be negative/,
    );
  });
});

describe("contributionMarginPct", () => {
  it("computes the cheese_bun golden fixture margin at 6 dp (after direct labour)", () => {
    // 24.5782 / 33.9130 × 100 = 72.474272… → 72.474272 (the fixture displays
    // the 4 dp form, 72.4743).
    expect(contributionMarginPct("33.9130", "24.5782")).toBe("72.474272");
  });

  it("computes the cheese_bun before-labour margin at 6 dp", () => {
    // 27.1330 / 33.9130 × 100 = 80.007667… → 80.007667 (fixture: 80.0077).
    expect(contributionMarginPct("33.9130", "27.1330")).toBe("80.007667");
  });

  it("returns null for non-positive net sales (renders n/a, never 0)", () => {
    expect(contributionMarginPct("0", "1.0000")).toBeNull();
    expect(contributionMarginPct("-1.0000", "1.0000")).toBeNull();
  });

  it("allows a negative margin for a loss-making unit", () => {
    expect(contributionMarginPct("10.0000", "-4.3348")).toBe("-43.348000");
  });
});

describe("requiredNetPrice", () => {
  it("solves the net price for a target contribution rate", () => {
    // 10 / (1 − 0.5) = 20.
    expect(requiredNetPrice("10.0000", "0.500000")).toBe("20.0000");
  });

  it("is the variable cost at a zero target rate", () => {
    expect(requiredNetPrice("10.0000", "0")).toBe("10.0000");
  });

  it("rejects a target rate of 1 or more as unattainable", () => {
    expect(() => requiredNetPrice("10.0000", "1.000000")).toThrow(
      /targetContributionRate must be in \[0, 1\)/,
    );
    expect(() => requiredNetPrice("10.0000", "1.500000")).toThrow(DomainError);
  });

  it("rejects a negative target rate or variable cost", () => {
    expect(() => requiredNetPrice("10.0000", "-0.1")).toThrow(DomainError);
    expect(() => requiredNetPrice("-10.0000", "0.5")).toThrow(
      /unitVariableCost must not be negative/,
    );
  });
});

describe("breakEvenUnits", () => {
  it("divides the fixed cost by the contribution per unit at 6 dp", () => {
    expect(breakEvenUnits("1000.0000", "25.0000")).toBe("40.000000");
  });

  it("rounds HALF_UP at quantity scale", () => {
    // 100 / 3 = 33.333333…
    expect(breakEvenUnits("100.0000", "3.0000")).toBe("33.333333");
  });

  it("rejects a negative fixed cost", () => {
    expect(() => breakEvenUnits("-1", "25.0000")).toThrow(/fixedCost must not be negative/);
  });

  it("rejects a zero or negative contribution per unit", () => {
    expect(() => breakEvenUnits("1000.0000", "0")).toThrow(/contributionPerUnit must be positive/);
    expect(() => breakEvenUnits("1000.0000", "-1.0000")).toThrow(DomainError);
  });
});

describe("isEffectiveAt", () => {
  const window = {
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: "2026-02-01T00:00:00Z",
  };

  it("is effective exactly at effectiveFrom (inclusive)", () => {
    expect(isEffectiveAt(window, "2026-01-01T00:00:00Z")).toBe(true);
  });

  it("is not effective exactly at effectiveTo (exclusive)", () => {
    expect(isEffectiveAt(window, "2026-02-01T00:00:00Z")).toBe(false);
  });

  it("is effective between the bounds and not before/after", () => {
    expect(isEffectiveAt(window, "2026-01-15T12:00:00Z")).toBe(true);
    expect(isEffectiveAt(window, "2025-12-31T23:59:59Z")).toBe(false);
    expect(isEffectiveAt(window, "2026-02-01T00:00:01Z")).toBe(false);
  });

  it("treats a null effectiveTo as open-ended", () => {
    const open = { effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null };
    expect(isEffectiveAt(open, "2030-06-01T00:00:00Z")).toBe(true);
    expect(isEffectiveAt(open, "2025-12-31T23:59:59Z")).toBe(false);
  });

  it("compares by parsed time, so an offset does not break ordering", () => {
    // 2026-01-01T00:00:00+01:00 is 2025-12-31T23:00:00Z.
    expect(isEffectiveAt(window, "2025-12-31T23:00:00Z")).toBe(false);
    expect(isEffectiveAt(window, "2026-01-01T01:00:00+01:00")).toBe(true);
    expect(isEffectiveAt(window, "2026-01-31T23:59:59-02:00")).toBe(false);
  });

  it("rejects an invalid instant", () => {
    expect(() => isEffectiveAt(window, "not-a-date")).toThrow(DomainError);
    expect(() =>
      isEffectiveAt({ effectiveFrom: "nope", effectiveTo: null }, "2026-01-01T00:00:00Z"),
    ).toThrow(/effectiveFrom must be a valid ISO-8601 instant/);
  });
});

describe("priceVersionWindowsOverlap", () => {
  const january = { effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: "2026-02-01T00:00:00Z" };

  it("detects an overlap when the ranges intersect", () => {
    const overlap = { effectiveFrom: "2026-01-15T00:00:00Z", effectiveTo: "2026-03-01T00:00:00Z" };
    expect(priceVersionWindowsOverlap(january, overlap)).toBe(true);
    expect(priceVersionWindowsOverlap(overlap, january)).toBe(true);
  });

  it("does not treat touching windows as overlapping", () => {
    const february = { effectiveFrom: "2026-02-01T00:00:00Z", effectiveTo: "2026-03-01T00:00:00Z" };
    expect(priceVersionWindowsOverlap(january, february)).toBe(false);
    expect(priceVersionWindowsOverlap(february, january)).toBe(false);
  });

  it("does not treat disjoint windows as overlapping", () => {
    const later = { effectiveFrom: "2026-04-01T00:00:00Z", effectiveTo: null };
    expect(priceVersionWindowsOverlap(january, later)).toBe(false);
  });

  it("overlaps an open-ended window that starts inside the range", () => {
    const open = { effectiveFrom: "2026-01-15T00:00:00Z", effectiveTo: null };
    expect(priceVersionWindowsOverlap(january, open)).toBe(true);
  });

  it("overlaps when both windows are open-ended", () => {
    const a = { effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null };
    const b = { effectiveFrom: "2026-06-01T00:00:00Z", effectiveTo: null };
    expect(priceVersionWindowsOverlap(a, b)).toBe(true);
  });

  it("rejects an invalid instant", () => {
    expect(() =>
      priceVersionWindowsOverlap(january, { effectiveFrom: "x", effectiveTo: null }),
    ).toThrow(DomainError);
  });
});

describe("selectEffectivePriceVersion", () => {
  const versions = [
    { id: "v1", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: "2026-02-01T00:00:00Z" },
    { id: "v2", effectiveFrom: "2026-02-01T00:00:00Z", effectiveTo: null },
  ];

  it("returns the version effective at the instant", () => {
    expect(selectEffectivePriceVersion(versions, "2026-01-15T00:00:00Z")?.id).toBe("v1");
    expect(selectEffectivePriceVersion(versions, "2026-02-01T00:00:00Z")?.id).toBe("v2");
    expect(selectEffectivePriceVersion(versions, "2030-01-01T00:00:00Z")?.id).toBe("v2");
  });

  it("returns undefined when no version is effective", () => {
    expect(selectEffectivePriceVersion(versions, "2025-12-31T00:00:00Z")).toBeUndefined();
  });

  it("throws when two versions are effective at once", () => {
    const ambiguous = [
      { id: "a", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null },
      { id: "b", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null },
    ];
    expect(() => selectEffectivePriceVersion(ambiguous, "2026-06-01T00:00:00Z")).toThrow(
      DomainError,
    );
  });

  it("rejects an invalid instant", () => {
    expect(() => selectEffectivePriceVersion(versions, "not-a-date")).toThrow(DomainError);
  });
});
