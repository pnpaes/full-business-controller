import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  defaultToleranceFor,
  explodeTheoreticalConsumption,
  withinTolerance,
} from "./sales-consumption";

describe("explodeTheoreticalConsumption", () => {
  it("explodes a sold quantity into component consumption (quantity × qty / yield)", () => {
    const lines = explodeTheoreticalConsumption({
      soldQuantity: "10.000000",
      usableYieldRate: "0.900000",
      components: [{ itemId: "item-milk", quantityPerOutput: "0.020000" }],
    });
    // 10 × 0.02 / 0.9 = 0.222222…
    expect(lines).toEqual([{ itemId: "item-milk", quantity: "0.222222" }]);
  });

  it("applies the recipe line loss factor before the yield gross-up (§6)", () => {
    const lines = explodeTheoreticalConsumption({
      soldQuantity: "10.000000",
      usableYieldRate: "1.000000",
      components: [{ itemId: "item-beef", quantityPerOutput: "0.020000", lossFactor: "0.800000" }],
    });
    // 10 × 0.02 / 0.8 = 0.25
    expect(lines).toEqual([{ itemId: "item-beef", quantity: "0.250000" }]);
  });

  it("rounds HALF_UP exactly once at the 6 dp boundary", () => {
    // 1 × 1 / 0.6 = 1.6666666… → up; 1 × 1 / 0.3 = 3.3333333… → down.
    const up = explodeTheoreticalConsumption({
      soldQuantity: "1.000000",
      usableYieldRate: "1.000000",
      components: [{ itemId: "a", quantityPerOutput: "1.000000", lossFactor: "0.600000" }],
    });
    const down = explodeTheoreticalConsumption({
      soldQuantity: "1.000000",
      usableYieldRate: "1.000000",
      components: [{ itemId: "b", quantityPerOutput: "1.000000", lossFactor: "0.300000" }],
    });
    expect(up[0]?.quantity).toBe("1.666667");
    expect(down[0]?.quantity).toBe("3.333333");
  });

  it("rounds an exact half up (half away from zero)", () => {
    // 0.000001 × 0.000001 / (0.000002 × 1) = 0.0000005 → 0.000001
    const lines = explodeTheoreticalConsumption({
      soldQuantity: "0.000001",
      usableYieldRate: "1.000000",
      components: [{ itemId: "a", quantityPerOutput: "0.000001", lossFactor: "0.000002" }],
    });
    expect(lines[0]?.quantity).toBe("0.000001");
  });

  it("aggregates repeated component items and sorts deterministically", () => {
    const lines = explodeTheoreticalConsumption({
      soldQuantity: "2.000000",
      usableYieldRate: "1.000000",
      components: [
        { itemId: "z", quantityPerOutput: "1.000000" },
        { itemId: "a", quantityPerOutput: "0.500000" },
        { itemId: "z", quantityPerOutput: "0.250000" },
      ],
    });
    expect(lines).toEqual([
      { itemId: "a", quantity: "1.000000" },
      { itemId: "z", quantity: "2.500000" },
    ]);
  });

  it("rejects an out-of-range yield, loss factor and negative sold quantity", () => {
    expect(() =>
      explodeTheoreticalConsumption({
        soldQuantity: "1",
        usableYieldRate: "1.500000",
        components: [{ itemId: "a", quantityPerOutput: "1" }],
      }),
    ).toThrow(DomainError);
    expect(() =>
      explodeTheoreticalConsumption({
        soldQuantity: "1",
        usableYieldRate: "1",
        components: [{ itemId: "a", quantityPerOutput: "1", lossFactor: "0" }],
      }),
    ).toThrow(DomainError);
    expect(() =>
      explodeTheoreticalConsumption({
        soldQuantity: "-1",
        usableYieldRate: "1",
        components: [],
      }),
    ).toThrow(DomainError);
  });
});

describe("defaultToleranceFor (DEC-026)", () => {
  it("takes the greater of 0.5% and 5 NOK for sales/settlement", () => {
    expect(defaultToleranceFor("sales_settlement", "1000.0000")).toBe("5.0000");
    expect(defaultToleranceFor("sales_settlement", "2000.0000")).toBe("10.0000");
  });

  it("takes the greater of 1% and 10 NOK for a supplier invoice", () => {
    expect(defaultToleranceFor("supplier_invoice", "1000.0000")).toBe("10.0000");
    expect(defaultToleranceFor("supplier_invoice", "2000.0000")).toBe("20.0000");
  });

  it("uses the absolute expected amount for a credit/refund", () => {
    expect(defaultToleranceFor("sales_settlement", "-1000.0000")).toBe("5.0000");
  });
});

describe("withinTolerance", () => {
  it("is within tolerance at the sales/settlement boundary and outside past it", () => {
    const within = withinTolerance({
      expected: "1000.0000",
      actual: "1003.0000",
      kind: "sales_settlement",
    });
    expect(within).toMatchObject({
      tolerance: "5.0000",
      difference: "3.0000",
      absoluteDifference: "3.0000",
      withinTolerance: true,
    });

    const outside = withinTolerance({
      expected: "1000.0000",
      actual: "1006.0000",
      kind: "sales_settlement",
    });
    expect(outside.withinTolerance).toBe(false);
    expect(outside.absoluteDifference).toBe("6.0000");
  });

  it("applies the supplier-invoice tolerance", () => {
    expect(
      withinTolerance({ expected: "1000.0000", actual: "1009.0000", kind: "supplier_invoice" })
        .withinTolerance,
    ).toBe(true);
    expect(
      withinTolerance({ expected: "1000.0000", actual: "1011.0000", kind: "supplier_invoice" })
        .withinTolerance,
    ).toBe(false);
  });

  it("honours an explicit caller override and signs the difference", () => {
    const result = withinTolerance({
      expected: "1000.0000",
      actual: "997.0000",
      kind: "sales_settlement",
      tolerance: "1.0000",
    });
    expect(result).toMatchObject({
      tolerance: "1.0000",
      difference: "-3.0000",
      absoluteDifference: "3.0000",
      withinTolerance: false,
    });
  });

  it("rejects a negative tolerance override", () => {
    expect(() =>
      withinTolerance({
        expected: "10.0000",
        actual: "10.0000",
        kind: "sales_settlement",
        tolerance: "-1",
      }),
    ).toThrow(DomainError);
  });
});
