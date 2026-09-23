import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { resolveAllocatedUnitOverhead } from "./resolve-allocated-unit-overhead";
import type { AllocationRuleRecord, OperatingCostRecord } from "./types";

const ORG = "org-1";
const POOL = "pool-1";
const LOCATION = "location-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");

function cost(overrides: Partial<OperatingCostRecord> = {}): OperatingCostRecord {
  return {
    id: "oc-1",
    organizationId: ORG,
    locationId: null,
    costCenterId: "cc-1",
    costPoolId: POOL,
    amount: "1000.0000",
    currency: "NOK",
    recurrence: "monthly",
    behavior: "fixed",
    taxBasis: "exclusive",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    vendor: null,
    evidenceFileId: null,
    ...overrides,
  };
}

function rule(overrides: Partial<AllocationRuleRecord> = {}): AllocationRuleRecord {
  return {
    id: "rule-1",
    costPoolId: POOL,
    driver: "eligible_products",
    scopeType: "location",
    denominatorSource: "explicit",
    fallbackBehavior: "stop",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  };
}

function store(input: {
  readonly costs?: readonly OperatingCostRecord[];
  readonly rules?: readonly AllocationRuleRecord[];
  readonly count?: number;
}) {
  return {
    listEffectiveOperatingCosts: () => Promise.resolve(input.costs ?? []),
    listEffectiveAllocationRules: () => Promise.resolve(input.rules ?? [rule()]),
    countEligibleProducts: () => Promise.resolve(input.count ?? 0),
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    costPoolId: POOL,
    locationId: LOCATION,
    asOf: AS_OF,
    ...overrides,
  };
}

describe("resolveAllocatedUnitOverhead", () => {
  it("is not resolved when no allocation rule is effective", async () => {
    const result = await resolveAllocatedUnitOverhead(store({ rules: [] }), baseInput());
    expect(result).toBeUndefined();
  });

  it("rejects more than one effective rule as ambiguous", async () => {
    await expect(
      resolveAllocatedUnitOverhead(store({ rules: [rule(), rule({ id: "rule-2" })] }), baseInput()),
    ).rejects.toThrow(/ambiguous allocation rules/);
  });

  it("sums the overlapping pool costs and divides by the explicit volume", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [
          cost({ id: "oc-1", amount: "1000.0000" }),
          cost({ id: "oc-2", amount: "200.0000" }),
          // Outside the default June 2026 period: excluded.
          cost({ id: "oc-old", amount: "5000.0000", effectiveTo: "2025-06-01" }),
        ],
      }),
      baseInput({ explicitTotalDriverVolume: "3" }),
    );

    expect(result).toEqual({
      perUnitOverhead: "400.0000",
      poolAmount: "1200.0000",
      totalDriverVolume: "3",
      denominatorSource: "explicit",
      fallbackUsed: "stop",
      operatingCostIds: ["oc-1", "oc-2"],
    });
  });

  it("fails closed when an explicit denominator source has no volume", async () => {
    await expect(
      resolveAllocatedUnitOverhead(store({ costs: [cost()] }), baseInput()),
    ).rejects.toThrow(/explicitTotalDriverVolume is required/);
  });

  it("counts eligible products when the rule says eligible_products", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [cost({ amount: "1200.0000" })],
        rules: [rule({ denominatorSource: "eligible_products" })],
        count: 4,
      }),
      baseInput(),
    );
    expect(result?.totalDriverVolume).toBe("4");
    expect(result?.perUnitOverhead).toBe("300.0000");
  });

  it("spreads an equal share across the eligible count", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [cost({ amount: "1200.0000" })],
        rules: [rule({ denominatorSource: "equal_share" })],
        count: 4,
      }),
      baseInput(),
    );
    expect(result?.totalDriverVolume).toBe("4");
    expect(result?.perUnitOverhead).toBe("300.0000");
    expect(result?.fallbackUsed).toBe("equal_share");
  });

  it("fails closed on an unknown denominator source and an empty equal share", async () => {
    await expect(
      resolveAllocatedUnitOverhead(
        store({
          costs: [cost()],
          rules: [rule({ denominatorSource: "revenue" })],
        }),
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      resolveAllocatedUnitOverhead(
        store({
          costs: [cost()],
          rules: [rule({ denominatorSource: "equal_share" })],
          count: 0,
        }),
        baseInput(),
      ),
    ).rejects.toThrow(/eligibleEntityCount is required and positive/);
  });
});
