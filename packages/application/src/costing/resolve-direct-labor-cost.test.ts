import { describe, expect, it } from "vitest";

import { resolveDirectLaborCost } from "./resolve-direct-labor-cost";
import type { LaborRateRecord } from "./types";

const ORG = "org-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");

function rate(overrides: Partial<LaborRateRecord> = {}): LaborRateRecord {
  return {
    id: "rate-1",
    organizationId: ORG,
    costCenterId: "cc-1",
    roleCode: "kitchen",
    loadedHourlyRate: "306.57",
    productiveHoursPct: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  };
}

function store(found: LaborRateRecord | undefined) {
  return {
    findEffectiveLaborRate: () => Promise.resolve(found),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    asOf: AS_OF,
    preparationMinutes: 30,
    laborCostCenterId: "cc-1",
    laborRoleCode: "kitchen",
    approvedUsableOutput: "1000",
    ...overrides,
  };
}

describe("resolveDirectLaborCost", () => {
  it("is not resolved when the labour mapping or minutes are missing", async () => {
    expect(
      await resolveDirectLaborCost(store(rate()), input({ preparationMinutes: null })),
    ).toBeUndefined();
    expect(
      await resolveDirectLaborCost(store(rate()), input({ laborCostCenterId: null })),
    ).toBeUndefined();
    expect(
      await resolveDirectLaborCost(store(rate()), input({ laborRoleCode: null })),
    ).toBeUndefined();
  });

  it("is not resolved when no labour rate is effective", async () => {
    expect(await resolveDirectLaborCost(store(undefined), input())).toBeUndefined();
  });

  it("values the batch minutes and divides by the approved usable output (null pct = 100%)", async () => {
    const result = await resolveDirectLaborCost(store(rate()), input());
    // 30 min / 60 × 306.57 / 1000 = 0.153285 -> 0.1533 (B3 HALF_UP).
    expect(result).toEqual({
      perUnitCost: "0.1533",
      costCenterId: "cc-1",
      roleCode: "kitchen",
      effectiveLoadedHourlyRate: "306.57",
    });
  });

  it("applies the productive-hours share (DEC-055)", async () => {
    const result = await resolveDirectLaborCost(
      store(rate({ productiveHoursPct: "0.8500" })),
      input(),
    );
    expect(result?.effectiveLoadedHourlyRate).toBe("360.67");
    expect(result?.perUnitCost).toBe("0.1803");
  });
});
