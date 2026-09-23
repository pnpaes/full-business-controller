import { describe, expect, it } from "vitest";

import { allocateCostPool } from "./allocate-cost-pool";
import { computeLabourCost } from "./compute-labour-cost";
import { registerAllocationRule } from "./register-allocation-rule";
import { registerCostPool } from "./register-cost-pool";
import { registerLaborRate } from "./register-labor-rate";
import { registerOperatingCost } from "./register-operating-cost";
import { FakeCostingStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";
const JAN = "2026-01-01";
const AS_OF = new Date("2026-06-01T00:00:00Z");

function seedCostCenter(
  store: FakeCostingStore,
  id: string,
  organizationId = ORG,
  locationId: string | null = null,
): string {
  store.costCenters.set(id, {
    id,
    organizationId,
    locationId,
    code: id.toUpperCase(),
    name: id,
    kind: "kitchen",
  });
  return id;
}

function seedLocation(store: FakeCostingStore, id: string, organizationId = ORG): string {
  store.locations.set(id, { id, organizationId });
  return id;
}

function seedRate(
  store: FakeCostingStore,
  id: string,
  loadedHourlyRate: string,
  productiveHoursPct: string | null = null,
  costCenterId = "cc-1",
): string {
  store.laborRates.push({
    id,
    organizationId: ORG,
    costCenterId,
    roleCode: "kitchen",
    loadedHourlyRate,
    productiveHoursPct,
    effectiveFrom: JAN,
    effectiveTo: null,
  });
  return id;
}

function seedPool(store: FakeCostingStore, id: string, code = "POOL"): string {
  store.costPools.set(id, {
    id,
    organizationId: ORG,
    code,
    name: code,
    effectiveFrom: JAN,
    effectiveTo: null,
  });
  return id;
}

function seedRule(
  store: FakeCostingStore,
  id: string,
  costPoolId: string,
  overrides: Partial<{
    driver: string;
    scopeType: string;
    denominatorSource: string;
    fallbackBehavior: string;
  }> = {},
): string {
  store.allocationRules.push({
    id,
    costPoolId,
    driver: overrides.driver ?? "production_hours",
    scopeType: overrides.scopeType ?? "location",
    denominatorSource: overrides.denominatorSource ?? "production_hours",
    fallbackBehavior: overrides.fallbackBehavior ?? "stop",
    effectiveFrom: JAN,
    effectiveTo: null,
  });
  return id;
}

describe("registerLaborRate", () => {
  it("derives and persists the loaded rate, audits a fixed non-secret payload", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");

    const result = await registerLaborRate(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      roleCode: "kitchen",
      baseHourlyRate: "240",
      productiveHoursPct: "0.8500",
      effectiveFrom: JAN,
    });

    expect(result.loadedHourlyRate).toBe("306.57");
    expect(store.laborRates).toEqual([
      expect.objectContaining({
        id: result.laborRateId,
        loadedHourlyRate: "306.57",
        productiveHoursPct: "0.8500",
        effectiveFrom: JAN,
        effectiveTo: null,
      }),
    ]);
    expect(store.audits.at(-1)).toMatchObject({
      action: "costing.labor_rate.registered",
      entityType: "labor_rate",
      after: { cost_center_id: "cc-1", role_code: "kitchen", loaded_hourly_rate: "306.57" },
    });
  });

  it("accepts explicit percentages", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    const result = await registerLaborRate(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      roleCode: "front_of_house",
      baseHourlyRate: "210",
      feriepengerPct: "0.102000",
      employerContributionPct: "0.141000",
      pensionPct: "0.020000",
      effectiveFrom: JAN,
    });
    expect(result.loadedHourlyRate).toBe("268.25");
  });

  it("rejects an unknown role code", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    await expect(
      registerLaborRate(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-1",
        roleCode: "wizard",
        baseHourlyRate: "240",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/roleCode must be one of/);
  });

  it("rejects a non-advancing effective window", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    await expect(
      registerLaborRate(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-1",
        roleCode: "kitchen",
        baseHourlyRate: "240",
        effectiveFrom: JAN,
        effectiveTo: JAN,
      }),
    ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
  });

  it("rejects a negative base hourly rate", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    await expect(
      registerLaborRate(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-1",
        roleCode: "kitchen",
        baseHourlyRate: "-1",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/baseHourlyRate must not be negative/);
  });

  it("rejects a productive-hours share outside (0,1]", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      roleCode: "kitchen" as const,
      baseHourlyRate: "240",
      effectiveFrom: JAN,
    };
    await expect(
      registerLaborRate(store, { ...base, productiveHoursPct: "1.5000" }),
    ).rejects.toThrow(/productiveHoursPct must be in \(0, 1\]/);
    await expect(registerLaborRate(store, { ...base, productiveHoursPct: "0" })).rejects.toThrow(
      /productiveHoursPct must be in \(0, 1\]/,
    );
  });

  it("rejects a cost centre from another organization", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-other", "org-2");
    await expect(
      registerLaborRate(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-other",
        roleCode: "kitchen",
        baseHourlyRate: "240",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/cost center not found in organization/);
  });
});

describe("registerOperatingCost", () => {
  it("persists the cost and audits it", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    seedLocation(store, "loc-1");

    const result = await registerOperatingCost(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      locationId: "loc-1",
      amount: "12000",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: JAN,
      vendor: "Landlord",
    });

    expect(store.operatingCosts).toEqual([
      expect.objectContaining({
        id: result.operatingCostId,
        locationId: "loc-1",
        amount: "12000",
        currency: "NOK",
        recurrence: "monthly",
        vendor: "Landlord",
      }),
    ]);
    expect(store.audits.at(-1)).toMatchObject({
      action: "costing.operating_cost.registered",
      after: {
        cost_center_id: "cc-1",
        location_id: "loc-1",
        amount: "12000",
        recurrence: "monthly",
        behavior: "fixed",
        tax_basis: "exclusive",
      },
    });
  });

  it("stores a lower-case currency upper-cased", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    await registerOperatingCost(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      amount: "1000",
      currency: "usd",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: JAN,
    });
    expect(store.operatingCosts.at(-1)?.currency).toBe("USD");
  });

  it("rejects a bad vocabulary value and a negative amount", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      amount: "1000",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: JAN,
    };
    await expect(registerOperatingCost(store, { ...base, recurrence: "hourly" })).rejects.toThrow(
      /recurrence must be one of/,
    );
    await expect(registerOperatingCost(store, { ...base, behavior: "semi" })).rejects.toThrow(
      /behavior must be one of/,
    );
    await expect(registerOperatingCost(store, { ...base, taxBasis: "gross" })).rejects.toThrow(
      /taxBasis must be one of/,
    );
    await expect(registerOperatingCost(store, { ...base, amount: "-1" })).rejects.toThrow(
      /amount must not be negative/,
    );
    await expect(registerOperatingCost(store, { ...base, currency: "kr" })).rejects.toThrow(
      /is not a valid ISO 4217 currency code/,
    );
  });

  it("rejects a location from another organization", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    seedLocation(store, "loc-other", "org-2");
    await expect(
      registerOperatingCost(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-1",
        locationId: "loc-other",
        amount: "1000",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/location not found in organization/);
  });

  it("links the cost to a shared cost pool and audits it (DEC-112)", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    seedPool(store, "pool-1");

    const result = await registerOperatingCost(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCenterId: "cc-1",
      costPoolId: "pool-1",
      amount: "1200",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: JAN,
    });

    expect(store.operatingCosts.at(-1)).toMatchObject({
      id: result.operatingCostId,
      costPoolId: "pool-1",
    });
    expect(store.audits.at(-1)?.after).toMatchObject({ cost_pool_id: "pool-1" });
  });

  it("rejects a cost pool from another organization (DEC-112)", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    store.costPools.set("pool-other", {
      id: "pool-other",
      organizationId: "org-2",
      code: "P",
      name: "P",
      effectiveFrom: JAN,
      effectiveTo: null,
    });
    await expect(
      registerOperatingCost(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCenterId: "cc-1",
        costPoolId: "pool-other",
        amount: "1000",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/cost pool not found in organization/);
  });
});

describe("registerCostPool", () => {
  it("registers a pool after trimming its code and name", async () => {
    const store = new FakeCostingStore();
    const result = await registerCostPool(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "  OVERHEAD  ",
      name: "  Shared Overhead  ",
      effectiveFrom: JAN,
    });
    expect(store.costPools.get(result.costPoolId)).toMatchObject({
      code: "OVERHEAD",
      name: "Shared Overhead",
    });
    expect(store.audits.at(-1)?.action).toBe("costing.cost_pool.registered");
  });

  it("rejects an empty code or name", async () => {
    const store = new FakeCostingStore();
    await expect(
      registerCostPool(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "   ",
        name: "Shared",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/code must not be empty/);
    await expect(
      registerCostPool(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "SHARED",
        name: " ",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/name must not be empty/);
  });

  it("rejects a version overlapping an existing window", async () => {
    const store = new FakeCostingStore();
    await registerCostPool(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "OVERHEAD",
      name: "Shared",
      effectiveFrom: JAN,
    });
    await expect(
      registerCostPool(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "OVERHEAD",
        name: "Again",
        effectiveFrom: "2026-03-01",
      }),
    ).rejects.toThrow(/overlapping this effective window/);
  });

  it("accepts a non-overlapping successor version of the same code", async () => {
    const store = new FakeCostingStore();
    const first = await registerCostPool(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "OVERHEAD",
      name: "v1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-01",
    });
    const second = await registerCostPool(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "OVERHEAD",
      name: "v2",
      effectiveFrom: "2026-06-01",
    });
    expect(first.costPoolId).not.toBe(second.costPoolId);
    const versions = await store.listCostPoolsByCode(ORG, "OVERHEAD");
    expect(versions.map((version) => version.id)).toEqual([second.costPoolId, first.costPoolId]);
  });

  it("rejects a non-advancing effective window", async () => {
    const store = new FakeCostingStore();
    await expect(
      registerCostPool(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "OVERHEAD",
        name: "Shared",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      }),
    ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
  });

  it("rejects a malformed effective date", async () => {
    const store = new FakeCostingStore();
    await expect(
      registerCostPool(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "OVERHEAD",
        name: "Shared",
        effectiveFrom: "01/06/2026",
      }),
    ).rejects.toThrow(/effectiveFrom must be an ISO date/);
  });
});

describe("registerAllocationRule", () => {
  it("registers a rule defaulting the fallback to stop", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    const result = await registerAllocationRule(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costPoolId: "pool-1",
      driver: "production_hours",
      scopeType: "location",
      denominatorSource: "  eligible_products  ",
      effectiveFrom: JAN,
    });
    expect(store.allocationRules).toEqual([
      expect.objectContaining({
        id: result.allocationRuleId,
        denominatorSource: "eligible_products",
        fallbackBehavior: "stop",
      }),
    ]);
    expect(store.audits.at(-1)?.action).toBe("costing.allocation_rule.registered");
  });

  it("rejects bad vocabulary values and an unknown denominator source", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      costPoolId: "pool-1",
      driver: "production_hours",
      scopeType: "location",
      denominatorSource: "explicit",
      effectiveFrom: JAN,
    };
    await expect(registerAllocationRule(store, { ...base, driver: "vibes" })).rejects.toThrow(
      /driver must be one of/,
    );
    await expect(registerAllocationRule(store, { ...base, scopeType: "galaxy" })).rejects.toThrow(
      /scopeType must be one of/,
    );
    await expect(
      registerAllocationRule(store, { ...base, fallbackBehavior: "guess" }),
    ).rejects.toThrow(/fallbackBehavior must be one of/);
    await expect(
      registerAllocationRule(store, { ...base, denominatorSource: "  " }),
    ).rejects.toThrow(/denominatorSource must be one of/);
    await expect(
      registerAllocationRule(store, { ...base, denominatorSource: "production_hours" }),
    ).rejects.toThrow(/denominatorSource must be one of/);
  });

  it("rejects a cost pool from another organization", async () => {
    const store = new FakeCostingStore();
    store.costPools.set("pool-other", {
      id: "pool-other",
      organizationId: "org-2",
      code: "P",
      name: "P",
      effectiveFrom: JAN,
      effectiveTo: null,
    });
    await expect(
      registerAllocationRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costPoolId: "pool-other",
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "explicit",
        effectiveFrom: JAN,
      }),
    ).rejects.toThrow(/cost pool not found in organization/);
  });
});

describe("computeLabourCost", () => {
  it("treats a null productive-hours share as 100% productive (§7 golden)", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    seedRate(store, "rate-1", "306.57", null);

    const result = await computeLabourCost(store, {
      organizationId: ORG,
      costCenterId: "cc-1",
      roleCode: "kitchen",
      asOf: AS_OF,
      productiveMinutes: "0.500000",
    });

    expect(result.loadedHourlyRate).toBe("306.57");
    expect(result.effectiveLoadedHourlyRate).toBe("306.57");
    expect(result.directLaborCost).toBe("2.5548");
    expect(result.imputedOwnerLabor).toBe("0.0000");
    expect(result.cashView).toBe("2.5548");
    expect(result.economicView).toBe(result.cashView);
  });

  it("scales by the productive-hours share and imputes owner labour (DEC-048)", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    seedRate(store, "rate-1", "306.57", "0.8500");

    const result = await computeLabourCost(store, {
      organizationId: ORG,
      costCenterId: "cc-1",
      roleCode: "kitchen",
      asOf: AS_OF,
      productiveMinutes: "0.500000",
      imputedOwnerMinutes: "0.500000",
    });

    // 306.57 / 0.85 = 360.67; 0.5 min at 360.67 = 3.0056 (both paid and imputed).
    expect(result.effectiveLoadedHourlyRate).toBe("360.67");
    expect(result.directLaborCost).toBe("3.0056");
    expect(result.imputedOwnerLabor).toBe("3.0056");
    expect(result.cashView).toBe("3.0056");
    expect(result.economicView).toBe("6.0112");
    expect(result.economicView).not.toBe(result.cashView);
  });

  it("rejects when no rate is effective at the date", async () => {
    const store = new FakeCostingStore();
    seedCostCenter(store, "cc-1");
    await expect(
      computeLabourCost(store, {
        organizationId: ORG,
        costCenterId: "cc-1",
        roleCode: "kitchen",
        asOf: AS_OF,
        productiveMinutes: "1.000000",
      }),
    ).rejects.toThrow(/no labour rate effective for the role at the requested date/);
  });
});

describe("allocateCostPool", () => {
  it("allocates through the driver share (HALF_UP at each boundary)", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    seedRule(store, "rule-1", "pool-1");

    const result = await allocateCostPool(store, {
      organizationId: ORG,
      costPoolId: "pool-1",
      asOf: AS_OF,
      periodCostPoolAmount: "1000",
      entityDriverVolume: "50",
      totalDriverVolume: "100",
      eligibleDriverVolume: "25",
    });

    expect(result).toMatchObject({
      driver: "production_hours",
      denominatorSource: "production_hours",
      entityDriverShare: "0.500000",
      allocatedPoolAmount: "500.0000",
      allocatedUnitOverhead: "20.0000",
      fallbackUsed: "stop",
    });
  });

  it("stops when the denominator is zero under the default fallback", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    seedRule(store, "rule-1", "pool-1");
    await expect(
      allocateCostPool(store, {
        organizationId: ORG,
        costPoolId: "pool-1",
        asOf: AS_OF,
        periodCostPoolAmount: "1000",
        entityDriverVolume: "50",
        totalDriverVolume: "100",
        eligibleDriverVolume: "0",
      }),
    ).rejects.toThrow(/allocation denominator is missing or zero/);
  });

  it("spreads an equal share across the eligible entities when configured", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    seedRule(store, "rule-1", "pool-1", {
      driver: "equal_share",
      scopeType: "company_wide",
      denominatorSource: "headcount",
      fallbackBehavior: "equal_share",
    });

    const result = await allocateCostPool(store, {
      organizationId: ORG,
      costPoolId: "pool-1",
      asOf: AS_OF,
      periodCostPoolAmount: "1000",
      entityDriverVolume: "50",
      totalDriverVolume: "100",
      eligibleDriverVolume: "0",
      eligibleEntityCount: "2",
    });

    expect(result.allocatedPoolAmount).toBe("500.0000");
    expect(result.allocatedUnitOverhead).toBe("250.0000");
    expect(result.fallbackUsed).toBe("equal_share");
  });

  it("raises when equal_share is configured but eligibleEntityCount is omitted", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    seedRule(store, "rule-1", "pool-1", {
      driver: "equal_share",
      scopeType: "company_wide",
      denominatorSource: "headcount",
      fallbackBehavior: "equal_share",
    });
    await expect(
      allocateCostPool(store, {
        organizationId: ORG,
        costPoolId: "pool-1",
        asOf: AS_OF,
        periodCostPoolAmount: "1000",
        entityDriverVolume: "50",
        totalDriverVolume: "100",
        eligibleDriverVolume: "0",
      }),
    ).rejects.toThrow(/eligibleEntityCount is required when fallback is equal_share/);
  });

  it("rejects when no rule is effective, and when several are", async () => {
    const store = new FakeCostingStore();
    seedPool(store, "pool-1");
    const call = {
      organizationId: ORG,
      costPoolId: "pool-1",
      asOf: AS_OF,
      periodCostPoolAmount: "1000",
      entityDriverVolume: "50",
      totalDriverVolume: "100",
      eligibleDriverVolume: "25",
    };
    await expect(allocateCostPool(store, call)).rejects.toThrow(
      /no allocation rule effective for the cost pool at the requested date/,
    );

    seedRule(store, "rule-1", "pool-1");
    seedRule(store, "rule-2", "pool-1");
    await expect(allocateCostPool(store, call)).rejects.toThrow(
      /ambiguous allocation rules for the cost pool at the requested date/,
    );
  });
});
