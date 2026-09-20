import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  breakEvenUnits,
  channelVariableCost,
  contributionMarginPct,
  grossFromNet,
  includedTax,
  netFromGross,
  presentedMoney,
  requiredNetPrice,
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
