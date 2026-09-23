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
  readonly volume?: {
    readonly revenue: string;
    readonly transactions: string;
    readonly units: string;
  };
}) {
  const volumeQueries: {
    organizationId: string;
    locationId: string;
    from: string;
    to: string;
  }[] = [];
  return {
    volumeQueries,
    listEffectiveOperatingCosts: () => Promise.resolve(input.costs ?? []),
    listEffectiveAllocationRules: () => Promise.resolve(input.rules ?? [rule()]),
    countEligibleProducts: () => Promise.resolve(input.count ?? 0),
    sumSalesVolume: (query: {
      readonly organizationId: string;
      readonly locationId: string;
      readonly from: string;
      readonly to: string;
    }) => {
      volumeQueries.push({ ...query });
      return Promise.resolve(
        input.volume ?? { revenue: "0.0000", transactions: "0", units: "0.000000" },
      );
    },
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

  it("scales mixed-recurrence pool costs to the period (DEC-115)", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [
          cost({ id: "oc-monthly", amount: "1000.0000", recurrence: "monthly" }),
          cost({ id: "oc-annual", amount: "1200.0000", recurrence: "annual" }),
        ],
      }),
      baseInput({ explicitTotalDriverVolume: "2" }),
    );

    // monthly 1000 + annual 1200 × 30/365 (June 2026, 30 days) = 1098.6301369… → 1098.6301.
    expect(result?.poolAmount).toBe("1098.6301");
    expect(result?.operatingCostIds).toEqual(["oc-monthly", "oc-annual"]);
    expect(result?.perUnitOverhead).toBe("549.3151");
  });

  it("counts a one_off once in its period and excludes it elsewhere (DEC-115)", async () => {
    const costs = [
      cost({
        id: "oc-in",
        amount: "500.0000",
        recurrence: "one_off",
        effectiveFrom: "2026-06-15",
      }),
      cost({
        id: "oc-out",
        amount: "700.0000",
        recurrence: "one_off",
        effectiveFrom: "2025-01-01",
      }),
    ];

    const june = await resolveAllocatedUnitOverhead(
      store({ costs }),
      baseInput({ explicitTotalDriverVolume: "1" }),
    );
    expect(june?.poolAmount).toBe("500.0000");
    expect(june?.operatingCostIds).toEqual(["oc-in"]);

    // Its open-ended window still overlaps July, but it must not repeat.
    const july = await resolveAllocatedUnitOverhead(
      store({ costs }),
      baseInput({
        explicitTotalDriverVolume: "1",
        periodFrom: new Date("2026-07-01T00:00:00Z"),
        periodTo: new Date("2026-08-01T00:00:00Z"),
      }),
    );
    expect(july?.poolAmount).toBe("0.0000");
    expect(july?.operatingCostIds).toEqual([]);
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
          rules: [rule({ denominatorSource: "production_hours" })],
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

  it("divides the pool by the period revenue for a revenue denominator", async () => {
    const fake = store({
      costs: [cost({ amount: "500.0000" })],
      rules: [rule({ denominatorSource: "revenue" })],
      volume: { revenue: "1000.0000", transactions: "0", units: "0.000000" },
    });
    const result = await resolveAllocatedUnitOverhead(fake, baseInput());

    expect(result).toEqual({
      perUnitOverhead: "0.5000",
      poolAmount: "500.0000",
      totalDriverVolume: "1000.0000",
      denominatorSource: "revenue",
      fallbackUsed: "stop",
      operatingCostIds: ["oc-1"],
    });
    // The read is scoped to the resolver's location and the default June period.
    expect(fake.volumeQueries).toEqual([
      {
        organizationId: ORG,
        locationId: LOCATION,
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      },
    ]);
  });

  it("divides the pool by the transaction count for a transactions denominator", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [cost({ amount: "500.0000" })],
        rules: [rule({ denominatorSource: "transactions" })],
        volume: { revenue: "0.0000", transactions: "25", units: "0.000000" },
      }),
      baseInput(),
    );
    expect(result?.perUnitOverhead).toBe("20.0000");
    expect(result?.totalDriverVolume).toBe("25");
  });

  it("divides the pool by the unit volume for a sales_units denominator", async () => {
    const result = await resolveAllocatedUnitOverhead(
      store({
        costs: [cost({ amount: "500.0000" })],
        rules: [rule({ denominatorSource: "sales_units" })],
        volume: { revenue: "0.0000", transactions: "0", units: "50.000000" },
      }),
      baseInput(),
    );
    expect(result?.perUnitOverhead).toBe("10.0000");
    expect(result?.totalDriverVolume).toBe("50.000000");
  });

  it("fails closed on a zero or negative volume denominator", async () => {
    await expect(
      resolveAllocatedUnitOverhead(
        store({
          costs: [cost()],
          rules: [rule({ denominatorSource: "revenue" })],
          volume: { revenue: "0.0000", transactions: "0", units: "0.000000" },
        }),
        baseInput(),
      ),
    ).rejects.toThrow(/no revenue denominator for allocation rule/);

    await expect(
      resolveAllocatedUnitOverhead(
        store({
          costs: [cost()],
          rules: [rule({ denominatorSource: "sales_units" })],
          volume: { revenue: "0.0000", transactions: "0", units: "-3.000000" },
        }),
        baseInput(),
      ),
    ).rejects.toThrow(/no sales_units denominator for allocation rule/);
  });
});
