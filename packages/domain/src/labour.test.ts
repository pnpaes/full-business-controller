import { describe, expect, it } from "vitest";

import { formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import {
  applyProductiveHoursPct,
  computeLoadedHourlyRate,
  contributionBeforeAndAfterDirectLabor,
  directLaborCost,
  labourCostViews,
} from "./labour";
import { unitContribution } from "./pricing";

describe("computeLoadedHourlyRate", () => {
  it("computes the front-of-house loaded rate (base 210, LABOUR_ASSUMPTIONS §3)", () => {
    // 0.102 × 210 = 21.42; 0.141 × (210 + 21.42) = 32.63022 → 32.63;
    // 0.02 × 210 = 4.20; 210 + 21.42 + 32.63 + 4.20 = 268.25.
    const result = computeLoadedHourlyRate({ baseHourlyRate: "210" });

    expect(result.baseHourlyRate).toBe("210.00");
    expect(result.feriepenger).toBe("21.42");
    expect(result.employerContribution).toBe("32.63");
    expect(result.pension).toBe("4.20");
    expect(result.loadedHourlyRate).toBe("268.25");
  });

  it("computes the kitchen loaded rate (base 240, LABOUR_ASSUMPTIONS §3)", () => {
    const result = computeLoadedHourlyRate({ baseHourlyRate: "240" });

    expect(result.baseHourlyRate).toBe("240.00");
    expect(result.feriepenger).toBe("24.48");
    expect(result.employerContribution).toBe("37.29");
    expect(result.pension).toBe("4.80");
    expect(result.loadedHourlyRate).toBe("306.57");
  });

  it("keeps the components exactly additive in decimal", () => {
    const result = computeLoadedHourlyRate({ baseHourlyRate: "210" });
    const componentSum =
      parseDecimal(result.feriepenger, 2) +
      parseDecimal(result.employerContribution, 2) +
      parseDecimal(result.pension, 2) +
      parseDecimal(result.baseHourlyRate, 2);
    expect(formatDecimal(componentSum, 2)).toBe(result.loadedHourlyRate);
  });

  it("accepts explicit percentages and a zero base", () => {
    const result = computeLoadedHourlyRate({
      baseHourlyRate: "0",
      feriepengerPct: "0",
      employerContributionPct: "0",
      pensionPct: "0",
    });

    expect(result).toEqual({
      baseHourlyRate: "0.00",
      feriepenger: "0.00",
      employerContribution: "0.00",
      pension: "0.00",
      loadedHourlyRate: "0.00",
    });
  });

  it("rejects a negative base hourly rate", () => {
    expect(() => computeLoadedHourlyRate({ baseHourlyRate: "-1" })).toThrow(
      /baseHourlyRate must not be negative/,
    );
  });

  it("rejects a feriepenger percentage above 1", () => {
    expect(() => computeLoadedHourlyRate({ baseHourlyRate: "210", feriepengerPct: "1.5" })).toThrow(
      /feriepengerPct must be in \[0, 1\]/,
    );
  });

  it("rejects a negative pension percentage", () => {
    expect(() => computeLoadedHourlyRate({ baseHourlyRate: "210", pensionPct: "-0.01" })).toThrow(
      /pensionPct must be in \[0, 1\]/,
    );
  });

  it("rejects a percentage with more than 6 decimal places", () => {
    expect(() =>
      computeLoadedHourlyRate({ baseHourlyRate: "210", employerContributionPct: "0.1410001" }),
    ).toThrow(DomainError);
  });
});

describe("applyProductiveHoursPct", () => {
  it("divides the loaded rate by the productive-hours share", () => {
    // 306.57 / 0.85 = 360.6705… → 360.67.
    expect(applyProductiveHoursPct("306.57", "0.850000")).toBe("360.67");
  });

  it("is the identity at a 100% productive share", () => {
    expect(applyProductiveHoursPct("268.25", "1")).toBe("268.25");
  });

  it("rejects a zero productive share", () => {
    expect(() => applyProductiveHoursPct("306.57", "0")).toThrow(
      /productiveHoursPct must be in \(0, 1\]/,
    );
  });

  it("rejects a productive share above 1", () => {
    expect(() => applyProductiveHoursPct("306.57", "1.01")).toThrow(
      /productiveHoursPct must be in \(0, 1\]/,
    );
  });
});

describe("directLaborCost", () => {
  it("computes the golden fixture (0.5 min at the kitchen loaded rate 306.57)", () => {
    expect(directLaborCost("0.500000", "306.57")).toBe("2.5548");
  });

  it("is zero for zero productive minutes", () => {
    expect(directLaborCost("0", "306.57")).toBe("0.0000");
  });

  it("computes the coffee fixture (0.4 min at the front-of-house loaded rate 268.25)", () => {
    expect(directLaborCost("0.400000", "268.25")).toBe("1.7883");
  });

  it("rounds HALF_UP where the 5th decimal decides", () => {
    // 1 min at 306.57/h = 5.1095 exactly at 4 dp.
    expect(directLaborCost("1.000000", "306.57")).toBe("5.1095");
  });
});

describe("labourCostViews", () => {
  it("splits paid and imputed owner labour into economic and cash views (DEC-048)", () => {
    const views = labourCostViews({ paidDirectLabor: "2.5548", imputedOwnerLabor: "1.2774" });

    expect(views.economicView).toBe("3.8322");
    expect(views.cashView).toBe("2.5548");
  });

  it("defaults the imputed owner labour to zero", () => {
    const views = labourCostViews({ paidDirectLabor: "2.5548" });

    expect(views.economicView).toBe("2.5548");
    expect(views.cashView).toBe("2.5548");
  });

  it("rejects a negative paid labour amount", () => {
    expect(() => labourCostViews({ paidDirectLabor: "-1" })).toThrow(
      /paidDirectLabor must not be negative/,
    );
  });

  it("rejects a negative imputed owner labour amount", () => {
    expect(() => labourCostViews({ paidDirectLabor: "1", imputedOwnerLabor: "-1" })).toThrow(
      /imputedOwnerLabor must not be negative/,
    );
  });
});

describe("contributionBeforeAndAfterDirectLabor", () => {
  it("computes the golden fixture before and after direct labour (COST-006)", () => {
    const result = contributionBeforeAndAfterDirectLabor({
      unitNetSales: "33.9130",
      variableCostBeforeLabor: "6.7800",
      directLaborCost: "2.5548",
    });

    expect(result.contributionBeforeDirectLabor).toBe("27.1330");
    expect(result.contributionAfterDirectLabor).toBe("24.5782");
  });

  it("agrees with two direct unitContribution calls (§8 single authority)", () => {
    const result = contributionBeforeAndAfterDirectLabor({
      unitNetSales: "33.9130",
      variableCostBeforeLabor: "6.7800",
      directLaborCost: "2.5548",
    });

    expect(result.contributionBeforeDirectLabor).toBe(unitContribution("33.9130", "6.7800"));
    expect(result.contributionAfterDirectLabor).toBe(unitContribution("33.9130", "9.3348"));
  });

  it("does not reject negative net sales", () => {
    const result = contributionBeforeAndAfterDirectLabor({
      unitNetSales: "-1.0000",
      variableCostBeforeLabor: "0.5000",
      directLaborCost: "0.1000",
    });

    expect(result.contributionBeforeDirectLabor).toBe("-1.5000");
    expect(result.contributionAfterDirectLabor).toBe("-1.6000");
  });

  it("rejects a negative variable cost before labour", () => {
    expect(() =>
      contributionBeforeAndAfterDirectLabor({
        unitNetSales: "10",
        variableCostBeforeLabor: "-1",
        directLaborCost: "1",
      }),
    ).toThrow(/variableCostBeforeLabor must not be negative/);
  });

  it("rejects a negative direct labour cost", () => {
    expect(() =>
      contributionBeforeAndAfterDirectLabor({
        unitNetSales: "10",
        variableCostBeforeLabor: "1",
        directLaborCost: "-1",
      }),
    ).toThrow(/directLaborCost must not be negative/);
  });
});
