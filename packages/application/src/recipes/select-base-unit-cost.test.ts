import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { observationBaseUnitCost, selectBaseUnitCost } from "./select-base-unit-cost";

const d = (iso: string) => new Date(iso);

describe("selectBaseUnitCost (DEC-047 precedence)", () => {
  it("prefers the latest effective supplier price", () => {
    const selected = selectBaseUnitCost({
      supplierPrices: [
        { cost: "0.1000", effectiveFrom: d("2026-01-01T00:00:00Z") },
        { cost: "0.2000", effectiveFrom: d("2026-06-01T00:00:00Z") },
      ],
      observations: [{ cost: "9.0000", observedAt: "2026-07-01" }],
      currentCost: "5.0000",
    });
    expect(selected).toEqual({
      cost: "0.2000",
      sourceType: "supplier_price",
      observedAt: d("2026-06-01T00:00:00Z"),
    });
  });

  it("falls back to the latest observation, then current_cost", () => {
    const observation = selectBaseUnitCost({
      supplierPrices: [],
      observations: [
        { cost: "0.1000", observedAt: "2026-01-01" },
        { cost: "0.3000", observedAt: "2026-02-01" },
      ],
      currentCost: "5.0000",
    });
    expect(observation.sourceType).toBe("cost_observation");
    expect(observation.cost).toBe("0.3000");

    const current = selectBaseUnitCost({
      supplierPrices: [],
      observations: [],
      currentCost: "5.0000",
    });
    expect(current).toEqual({ cost: "5.0000", sourceType: "current_cost", observedAt: null });
  });

  it("rejects a same-instant disagreement inside a tier instead of guessing", () => {
    expect(() =>
      selectBaseUnitCost({
        supplierPrices: [
          { cost: "0.1000", effectiveFrom: d("2026-06-01T00:00:00Z") },
          { cost: "0.2000", effectiveFrom: d("2026-06-01T00:00:00Z") },
        ],
        observations: [],
        currentCost: null,
      }),
    ).toThrow(/ambiguous supplier price/);
  });

  it("rejects when no source exists", () => {
    expect(() =>
      selectBaseUnitCost({ supplierPrices: [], observations: [], currentCost: null }),
    ).toThrow(DomainError);
  });
});

describe("observationBaseUnitCost", () => {
  it("divides the pack price by the pack size at 4 dp", () => {
    // 100.0000 / 1000.000000 = 0.1000
    expect(observationBaseUnitCost("100.0000", "1000.000000")).toBe("0.1000");
  });

  it("rejects a non-positive pack size", () => {
    expect(() => observationBaseUnitCost("100.0000", "0")).toThrow(/pack_size must be positive/);
  });
});
