import { describe, expect, it } from "vitest";

import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  SnapshotComponentRecord,
} from "./cost-card-types";
import type { PriceScenarioRecord } from "./price-scenario-types";
import {
  COST_CARD_HISTORY_LIMIT,
  getCostCardDetail,
  getPriceScenarioDetail,
  listAllocationRules,
  listCostCards,
  listCostPools,
  listLaborRates,
  listOperatingCosts,
  listPriceScenarios,
} from "./read";
import { FakeCostingReadStore, seedCostingReadFixture } from "./read-test-support";
import type { AllocationRuleReadRecord } from "./read-types";
import type { CostPoolRecord, LaborRateRecord, OperatingCostRecord } from "./types";

function card(overrides: Partial<CostCardRecord> & { readonly id: string }): CostCardRecord {
  return {
    organizationId: "org",
    productVariantId: "variant",
    locationId: "loc",
    channelId: null,
    recipeVersionId: null,
    state: "draft",
    costSelectionPolicy: "latest_approved_price",
    calculatedAt: "2026-09-01T08:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    snapshotId: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<CalculationSnapshotRecord> & { readonly id: string },
): CalculationSnapshotRecord {
  return {
    organizationId: "org",
    costCardId: null,
    priceScenarioId: null,
    costSelectionPolicy: "latest_approved_price",
    asOf: "2026-09-01T08:00:00.000Z",
    taxRuleSnapshot: {},
    fxRateId: null,
    roundingMethod: "HALF_UP",
    roundingScales: { qty: 6, money: 4, presented: 2 },
    ruleVersion: "v1",
    totals: { unitFullCost: "12.0000" },
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function component(
  overrides: Partial<SnapshotComponentRecord> & { readonly id: string },
): SnapshotComponentRecord {
  return {
    snapshotId: "snap",
    componentKind: "ingredient",
    itemId: null,
    quantity: null,
    unitId: null,
    unitCost: null,
    amount: null,
    roundingBoundary: null,
    provenance: {},
    ...overrides,
  };
}

function scenario(
  overrides: Partial<PriceScenarioRecord> & { readonly id: string },
): PriceScenarioRecord {
  return {
    organizationId: "org",
    productVariantId: "variant",
    locationId: null,
    channelId: null,
    grossPrice: null,
    netPrice: null,
    targetContributionPct: null,
    volumeAssumption: null,
    feeBreakdown: {},
    outcome: {},
    state: "draft",
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function operatingCost(id: string, organizationId: string): OperatingCostRecord {
  return {
    id,
    organizationId,
    locationId: null,
    costCenterId: "cost-center",
    amount: "10000.0000",
    currency: "NOK",
    recurrence: "monthly",
    behavior: "fixed",
    taxBasis: "exclusive",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    vendor: null,
    evidenceFileId: null,
  };
}

function laborRate(id: string, organizationId: string): LaborRateRecord {
  return {
    id,
    organizationId,
    costCenterId: "cost-center",
    roleCode: "kitchen",
    loadedHourlyRate: "306.57",
    productiveHoursPct: "0.8500",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  };
}

function costPool(id: string, organizationId: string): CostPoolRecord {
  return {
    id,
    organizationId,
    code: "OVERHEAD",
    name: "Shared overhead",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  };
}

function allocationRule(id: string): AllocationRuleReadRecord {
  return {
    id,
    costPoolId: "pool",
    driver: "production_hours",
    scopeType: "location",
    denominatorSource: "production_hours",
    fallbackBehavior: "stop",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    costPoolCode: "OVERHEAD",
  };
}

describe("costing read services", () => {
  it("lists only the served organization's cost cards, newest first", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    store.costCards.set("old", card({ id: "old", calculatedAt: "2026-08-01T00:00:00.000Z" }));
    store.costCards.set("new", card({ id: "new", calculatedAt: "2026-09-10T00:00:00.000Z" }));
    store.costCards.set(
      "foreign",
      card({ id: "foreign", organizationId: fixture.otherOrganizationId }),
    );

    const cards = await listCostCards(store, { organizationId: fixture.organizationId });

    expect(cards.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("lists price scenarios only for the served organization", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    store.priceScenarios.set("a", scenario({ id: "a" }));
    store.priceScenarios.set(
      "foreign",
      scenario({ id: "foreign", organizationId: fixture.otherOrganizationId }),
    );

    const scenarios = await listPriceScenarios(store, { organizationId: fixture.organizationId });

    expect(scenarios.map((row) => row.id)).toEqual(["a"]);
  });

  it("scopes each slice-6 list to the served organization", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    const { organizationId, otherOrganizationId } = fixture;
    store.operatingCosts.push(
      operatingCost("oc", organizationId),
      operatingCost("oc-f", otherOrganizationId),
    );
    store.laborRates.push(laborRate("lr", organizationId), laborRate("lr-f", otherOrganizationId));
    store.costPools.set("pool", costPool("pool", organizationId));
    store.costPools.set("pool-f", costPool("pool-f", otherOrganizationId));
    store.addAllocationRule(organizationId, allocationRule("rule"));
    store.addAllocationRule(otherOrganizationId, allocationRule("rule-f"));

    expect((await listOperatingCosts(store, { organizationId })).map((row) => row.id)).toEqual([
      "oc",
    ]);
    expect((await listLaborRates(store, { organizationId })).map((row) => row.id)).toEqual(["lr"]);
    expect((await listCostPools(store, { organizationId })).map((row) => row.id)).toEqual(["pool"]);
    expect((await listAllocationRules(store, { organizationId })).map((row) => row.id)).toEqual([
      "rule",
    ]);
  });

  it("assembles the cost-card detail with snapshot, components and same-scope history", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    store.costCards.set(
      "current",
      card({ id: "current", snapshotId: "snap-current", calculatedAt: "2026-09-10T00:00:00.000Z" }),
    );
    store.costCards.set(
      "prior",
      card({ id: "prior", snapshotId: "snap-prior", calculatedAt: "2026-09-01T00:00:00.000Z" }),
    );
    store.costCards.set(
      "other-scope",
      card({ id: "other-scope", locationId: "loc-other", snapshotId: "snap-other" }),
    );
    store.snapshots.set(
      "snap-current",
      snapshot({ id: "snap-current", totals: { unitFullCost: "13.0000" } }),
    );
    store.snapshots.set(
      "snap-prior",
      snapshot({ id: "snap-prior", totals: { unitFullCost: "12.0000" } }),
    );
    store.components.push(
      component({ id: "c1", snapshotId: "snap-current", componentKind: "direct_labor" }),
    );

    const detail = await getCostCardDetail(store, {
      organizationId: fixture.organizationId,
      costCardId: "current",
    });

    expect(detail?.card.id).toBe("current");
    expect(detail?.snapshot?.id).toBe("snap-current");
    expect(detail?.components.map((row) => row.id)).toEqual(["c1"]);
    expect(detail?.history.map((entry) => entry.card.id)).toEqual(["prior"]);
    expect(detail?.history[0]?.totals).toEqual({ unitFullCost: "12.0000" });
  });

  it("caps the history at the documented limit and keeps the newest", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    for (let index = 0; index < COST_CARD_HISTORY_LIMIT + 3; index += 1) {
      const day = String(index + 1).padStart(2, "0");
      store.costCards.set(
        `card-${index}`,
        card({ id: `card-${index}`, calculatedAt: `2026-08-${day}T00:00:00.000Z` }),
      );
    }

    const detail = await getCostCardDetail(store, {
      organizationId: fixture.organizationId,
      costCardId: `card-${COST_CARD_HISTORY_LIMIT + 2}`,
    });

    expect(detail?.history).toHaveLength(COST_CARD_HISTORY_LIMIT);
    expect(detail?.history[0]?.card.id).toBe(`card-${COST_CARD_HISTORY_LIMIT + 1}`);
  });

  it("reads an unknown or foreign cost card as undefined", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    store.costCards.set(
      "foreign",
      card({ id: "foreign", organizationId: fixture.otherOrganizationId }),
    );

    expect(
      await getCostCardDetail(store, {
        organizationId: fixture.organizationId,
        costCardId: "missing",
      }),
    ).toBeUndefined();
    expect(
      await getCostCardDetail(store, {
        organizationId: fixture.organizationId,
        costCardId: "foreign",
      }),
    ).toBeUndefined();
  });

  it("reads an unknown or foreign price scenario as undefined", async () => {
    const store = new FakeCostingReadStore();
    const fixture = seedCostingReadFixture(store);
    store.priceScenarios.set(
      "foreign",
      scenario({ id: "foreign", organizationId: fixture.otherOrganizationId }),
    );

    expect(
      await getPriceScenarioDetail(store, {
        organizationId: fixture.organizationId,
        priceScenarioId: "missing",
      }),
    ).toBeUndefined();
    expect(
      await getPriceScenarioDetail(store, {
        organizationId: fixture.organizationId,
        priceScenarioId: "foreign",
      }),
    ).toBeUndefined();
  });
});
