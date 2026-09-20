import { describe, expect, it } from "vitest";

import { computeCostCardTotals } from "./cost-card";
import { parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";

const cheeseBunComponents = {
  currency: "NOK",
  ingredientCost: "5.8800",
  packagingCost: "0.9000",
  directLaborCost: "2.5548",
  channelVariableCost: "0",
  otherVariableCost: "0",
  unitNetSales: "33.9130",
  allocatedUnitOverhead: "10.0000",
} as const;

describe("computeCostCardTotals", () => {
  it("computes the cheese_bun golden fixture totals", () => {
    const totals = computeCostCardTotals(cheeseBunComponents);

    expect(totals.currency).toBe("NOK");
    expect(totals.unitVariableCostBeforeLabor).toBe("6.7800");
    expect(totals.unitVariableCost).toBe("9.3348");
    expect(totals.contributionBeforeDirectLabor).toBe("27.1330");
    expect(totals.contributionAfterDirectLabor).toBe("24.5782");
    // 6 dp percentages (the fixture displays the 4 dp forms 80.0077 / 72.4743).
    expect(totals.contributionMarginPctBeforeLabor).toBe("80.007667");
    expect(totals.contributionMarginPctAfterLabor).toBe("72.474272");
    expect(totals.unitFullCost).toBe("19.3348");
    expect(totals.fullCostMargin).toBe("14.5782");
  });

  it("keeps the components additive on the full-cost chain", () => {
    const totals = computeCostCardTotals(cheeseBunComponents);

    // Golden values.
    expect(totals.unitFullCost).toBe("19.3348");
    expect(totals.fullCostMargin).toBe("14.5782");

    // Additivity asserted on the decimal primitives, not just the golden strings.
    const unitVariableCost = parseDecimal(totals.unitVariableCost, MONEY_SCALE);
    const allocatedUnitOverhead = parseDecimal(
      cheeseBunComponents.allocatedUnitOverhead,
      MONEY_SCALE,
    );
    const unitFullCost = parseDecimal(totals.unitFullCost, MONEY_SCALE);
    const unitNetSales = parseDecimal(cheeseBunComponents.unitNetSales, MONEY_SCALE);
    const fullCostMargin = parseDecimal(totals.fullCostMargin, MONEY_SCALE);

    // full cost = variable cost after labour + allocated overhead.
    expect(unitFullCost).toBe(unitVariableCost + allocatedUnitOverhead);
    // full-cost margin = net sales − full cost.
    expect(fullCostMargin).toBe(unitNetSales - unitFullCost);
  });

  it("reports a loss-making unit with a negative margin and percentage", () => {
    const totals = computeCostCardTotals({ ...cheeseBunComponents, unitNetSales: "5.0000" });

    expect(totals.contributionBeforeDirectLabor).toBe("-1.7800");
    expect(totals.contributionAfterDirectLabor).toBe("-4.3348");
    expect(totals.contributionMarginPctBeforeLabor).toBe("-35.600000");
    expect(totals.contributionMarginPctAfterLabor).toBe("-86.696000");
    expect(totals.fullCostMargin).toBe("-14.3348");
  });

  it("renders an undefined margin (null) when net sales are non-positive", () => {
    const zero = computeCostCardTotals({ ...cheeseBunComponents, unitNetSales: "0" });
    expect(zero.contributionMarginPctBeforeLabor).toBeNull();
    expect(zero.contributionMarginPctAfterLabor).toBeNull();

    const negative = computeCostCardTotals({ ...cheeseBunComponents, unitNetSales: "-1.0000" });
    expect(negative.contributionMarginPctAfterLabor).toBeNull();
  });

  it("rejects a negative direct labour cost", () => {
    expect(() =>
      computeCostCardTotals({ ...cheeseBunComponents, directLaborCost: "-1.0000" }),
    ).toThrow(/directLaborCost must not be negative/);
  });

  it("rejects a negative variable-cost component (via the pricing primitive)", () => {
    expect(() =>
      computeCostCardTotals({ ...cheeseBunComponents, ingredientCost: "-1.0000" }),
    ).toThrow(DomainError);
  });
});
