import { describe, expect, it } from "vitest";

import {
  allocatedPoolAmount,
  allocatedUnitOverhead,
  entityDriverShare,
  fullCostMargin,
  unitFullCost,
} from "./allocation";
import { DomainError } from "./errors";

describe("entityDriverShare", () => {
  it("computes the entity share of the driver volume at 6 dp", () => {
    expect(entityDriverShare("1.000000", "4.000000")).toBe("0.250000");
  });

  it("rounds HALF_UP at 6 dp", () => {
    // 1 / 3 = 0.3333333… → 0.333333.
    expect(entityDriverShare("1.000000", "3.000000")).toBe("0.333333");
  });

  it("rejects a non-positive total driver volume", () => {
    expect(() => entityDriverShare("1.000000", "0")).toThrow(/totalDriverVolume must be positive/);
  });

  it("rejects a negative entity driver volume", () => {
    expect(() => entityDriverShare("-1.000000", "4.000000")).toThrow(
      /entityDriverVolume must not be negative/,
    );
  });
});

describe("allocatedPoolAmount", () => {
  it("allocates the pool by the entity share, rounded once at 4 dp", () => {
    expect(allocatedPoolAmount("1000.0000", "1.000000", "4.000000")).toBe("250.0000");
  });

  it("sums to the pool across the entities (no double rounding)", () => {
    // 1000 × 1/3 = 333.3333… and 1000 × 2/3 = 666.6666….
    expect(allocatedPoolAmount("1000.0000", "1.000000", "3.000000")).toBe("333.3333");
    expect(allocatedPoolAmount("1000.0000", "2.000000", "3.000000")).toBe("666.6667");
  });

  it("rejects a non-positive total driver volume", () => {
    expect(() => allocatedPoolAmount("1000.0000", "1.000000", "0")).toThrow(
      /totalDriverVolume must be positive/,
    );
  });

  it("rejects a negative pool amount", () => {
    expect(() => allocatedPoolAmount("-1.0000", "1.000000", "4.000000")).toThrow(DomainError);
  });
});

describe("allocatedUnitOverhead", () => {
  it("divides the allocated amount by the eligible volume at 4 dp", () => {
    expect(allocatedUnitOverhead("100.0000", "10.000000")).toBe("10.0000");
  });

  it("stops allocation when the denominator is missing or zero (default fallback)", () => {
    expect(() => allocatedUnitOverhead("100.0000", "0")).toThrow(
      /allocation denominator is missing or zero/,
    );
    expect(() => allocatedUnitOverhead("100.0000", "0.000000", { fallback: "stop" })).toThrow(
      DomainError,
    );
  });

  it("divides equally across an explicit eligible-entity count when configured", () => {
    expect(
      allocatedUnitOverhead("100.0000", "0.000000", {
        fallback: "equal_share",
        eligibleEntityCount: "4",
      }),
    ).toBe("25.0000");
  });

  it("requires a positive eligible-entity count for the equal_share fallback", () => {
    expect(() =>
      allocatedUnitOverhead("100.0000", "0.000000", { fallback: "equal_share" }),
    ).toThrow(/eligibleEntityCount is required/);
    expect(() =>
      allocatedUnitOverhead("100.0000", "0.000000", {
        fallback: "equal_share",
        eligibleEntityCount: "0",
      }),
    ).toThrow(/eligibleEntityCount must be a positive integer/);
  });
});

describe("unitFullCost", () => {
  it("adds the allocated overhead to the unit variable cost at 4 dp", () => {
    expect(unitFullCost("6.7800", "10.0000")).toBe("16.7800");
  });

  it("rejects a negative allocated overhead", () => {
    expect(() => unitFullCost("6.7800", "-1")).toThrow(DomainError);
  });
});

describe("fullCostMargin", () => {
  it("subtracts the full cost from net sales at 4 dp", () => {
    expect(fullCostMargin("33.9130", "16.7800")).toBe("17.1330");
  });

  it("allows a negative margin", () => {
    expect(fullCostMargin("10.0000", "16.7800")).toBe("-6.7800");
  });

  it("rejects a negative full cost", () => {
    expect(() => fullCostMargin("10.0000", "-1")).toThrow(DomainError);
  });
});
