import { describe, expect, it } from "vitest";

import { approvePriceScenario, calculatePriceScenario } from "./price-scenario";
import type { CalculatePriceScenarioInput } from "./price-scenario";
import { FakePriceScenarioStore } from "./price-scenario-test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";
const VARIANT = "variant-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");
const RULE_VERSION = "2026-1";

function seedVariant(store: FakePriceScenarioStore, id = VARIANT, organizationId = ORG): string {
  store.productVariants.set(id, { id, organizationId });
  return id;
}

/** The cheese_bun golden fixture (GOLDEN_FIXTURES §2), 15 % inclusive tax. */
function cheeseBunInput(
  overrides: Partial<CalculatePriceScenarioInput> = {},
): CalculatePriceScenarioInput {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    productVariantId: VARIANT,
    asOf: AS_OF,
    ruleVersion: RULE_VERSION,
    costSelectionPolicy: "latest_approved_price",
    grossPrice: "39.00",
    taxBasis: "inclusive",
    taxRate: "0.150000",
    unitVariableCost: "9.3348",
    ...overrides,
  };
}

describe("calculatePriceScenario", () => {
  it("computes and persists the cheese_bun golden outcome", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    const result = await calculatePriceScenario(store, cheeseBunInput());

    expect(result.outcome).toEqual({
      grossPrice: "39.00",
      netPrice: "33.9130",
      unitVariableCost: "9.3348",
      channelVariableCost: "0.0000",
      unitContribution: "24.5782",
      contributionMarginPct: "72.474272",
      requiredNetPrice: null,
      breakEvenUnits: null,
    });

    const scenario = store.priceScenarios.get(result.priceScenarioId);
    expect(scenario).toMatchObject({
      state: "draft",
      grossPrice: "39.00",
      netPrice: "33.9130",
      targetContributionPct: null,
      feeBreakdown: {},
    });
    expect(scenario?.outcome).toEqual(result.outcome);

    expect(store.snapshots[0]).toMatchObject({
      id: result.snapshotId,
      priceScenarioId: result.priceScenarioId,
      costCardId: null,
      costSelectionPolicy: "latest_approved_price",
      ruleVersion: RULE_VERSION,
      roundingMethod: "HALF_UP",
      roundingScales: { qty: 6, money: 4, presented: 2 },
    });
    expect(store.snapshots[0]?.totals).toEqual(result.outcome);

    expect(store.audits).toEqual([
      expect.objectContaining({
        action: "costing.price_scenario.calculated",
        entityType: "price_scenario",
        entityId: result.priceScenarioId,
        after: { state: "draft", net_price: "33.9130", gross_price: "39.00" },
      }),
    ]);
  });

  it("computes a wolt-style channel fee and records the fee breakdown", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    const result = await calculatePriceScenario(
      store,
      cheeseBunInput({
        channelFee: { percentageFeeRate: "0.300000", feeBasisAmount: "53.9130" },
      }),
    );

    expect(result.outcome.channelVariableCost).toBe("16.1739");
    expect(store.priceScenarios.get(result.priceScenarioId)?.feeBreakdown).toEqual({
      percentageFeeRate: "0.300000",
      feeBasisAmount: "53.9130",
      amount: "16.1739",
    });
  });

  it("computes the required net price from a target contribution rate", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    const result = await calculatePriceScenario(
      store,
      cheeseBunInput({ targetContributionRate: "0.500000" }),
    );

    expect(result.outcome.requiredNetPrice).toBe("18.6696");
    expect(store.priceScenarios.get(result.priceScenarioId)?.targetContributionPct).toBe(
      "0.500000",
    );
  });

  it("computes break-even units for a positive contribution and null otherwise", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    const positive = await calculatePriceScenario(store, cheeseBunInput({ fixedCost: "1000" }));
    expect(positive.outcome.breakEvenUnits).toBe("40.686462");

    const nonPositive = await calculatePriceScenario(
      store,
      cheeseBunInput({ unitVariableCost: "40.00", fixedCost: "1000" }),
    );
    expect(nonPositive.outcome.unitContribution).toBe("-6.0870");
    expect(nonPositive.outcome.breakEvenUnits).toBeNull();
  });

  it("leaves the price undefined when neither grossPrice nor targetContributionRate is given", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    const result = await calculatePriceScenario(store, cheeseBunInput({ grossPrice: null }));

    expect(result.outcome).toMatchObject({
      netPrice: null,
      unitContribution: null,
      contributionMarginPct: null,
      requiredNetPrice: null,
      breakEvenUnits: null,
    });
    expect(store.priceScenarios.get(result.priceScenarioId)?.netPrice).toBeNull();
  });

  it("rejects a negative fixedCost even when the unit contribution is non-positive", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    await expect(
      calculatePriceScenario(
        store,
        // Net price 33.9130 < variable cost 40.00, so contribution is negative
        // and break-even is skipped; the negative fixedCost is still rejected.
        cheeseBunInput({ unitVariableCost: "40.00", fixedCost: "-1.0000" }),
      ),
    ).rejects.toThrow(/fixedCost must not be negative/);
    expect(store.priceScenarios.size).toBe(0);
  });

  it("rejects invalid inputs before touching the store", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    await expect(
      calculatePriceScenario(store, cheeseBunInput({ organizationId: "  " })),
    ).rejects.toThrow(/organizationId must not be empty/);
    await expect(
      calculatePriceScenario(store, cheeseBunInput({ costSelectionPolicy: "made_up" })),
    ).rejects.toThrow(/costSelectionPolicy must be one of/);
    await expect(
      calculatePriceScenario(store, cheeseBunInput({ unitVariableCost: "-1" })),
    ).rejects.toThrow(/unitVariableCost must not be negative/);
    await expect(
      calculatePriceScenario(store, cheeseBunInput({ targetContributionRate: "1.000000" })),
    ).rejects.toThrow(/targetContributionRate must be in \[0, 1\)/);
    expect(store.priceScenarios.size).toBe(0);
  });

  it("rejects a missing product variant and one from another organization", async () => {
    const store = new FakePriceScenarioStore();

    await expect(calculatePriceScenario(store, cheeseBunInput())).rejects.toThrow(
      /product variant not found/,
    );

    seedVariant(store, VARIANT, OTHER_ORG);
    await expect(calculatePriceScenario(store, cheeseBunInput())).rejects.toThrow(
      /product variant belongs to another organization/,
    );
  });
});

describe("approvePriceScenario", () => {
  async function seedDraft(store: FakePriceScenarioStore): Promise<{ priceScenarioId: string }> {
    seedVariant(store);
    const result = await calculatePriceScenario(store, cheeseBunInput());
    return { priceScenarioId: result.priceScenarioId };
  }

  it("approves a draft scenario and audits the transition", async () => {
    const store = new FakePriceScenarioStore();
    const { priceScenarioId } = await seedDraft(store);

    const result = await approvePriceScenario(store, {
      organizationId: ORG,
      actorId: ACTOR,
      priceScenarioId,
    });

    expect(result).toEqual({ priceScenarioId, state: "approved" });
    expect(store.priceScenarios.get(priceScenarioId)?.state).toBe("approved");
    expect(store.audits.at(-1)).toMatchObject({
      action: "costing.price_scenario.approved",
      entityId: priceScenarioId,
      before: { state: "draft" },
      after: { state: "approved" },
    });
  });

  it("rejects approving an already-approved scenario", async () => {
    const store = new FakePriceScenarioStore();
    const { priceScenarioId } = await seedDraft(store);
    const input = { organizationId: ORG, actorId: ACTOR, priceScenarioId };

    await approvePriceScenario(store, input);
    await expect(approvePriceScenario(store, input)).rejects.toThrow(
      /cannot be approved from state approved/,
    );
  });

  it("approves a submitted scenario", async () => {
    const store = new FakePriceScenarioStore();
    const { priceScenarioId } = await seedDraft(store);
    const submitted = store.priceScenarios.get(priceScenarioId)!;
    store.priceScenarios.set(priceScenarioId, { ...submitted, state: "submitted" });

    const result = await approvePriceScenario(store, {
      organizationId: ORG,
      actorId: ACTOR,
      priceScenarioId,
    });

    expect(result).toEqual({ priceScenarioId, state: "approved" });
    expect(store.priceScenarios.get(priceScenarioId)?.state).toBe("approved");
    expect(store.audits.at(-1)).toMatchObject({
      action: "costing.price_scenario.approved",
      entityId: priceScenarioId,
      before: { state: "submitted" },
      after: { state: "approved" },
    });
  });

  it("rejects a scenario in state rejected", async () => {
    const store = new FakePriceScenarioStore();
    const { priceScenarioId } = await seedDraft(store);
    const rejected = store.priceScenarios.get(priceScenarioId)!;
    store.priceScenarios.set(priceScenarioId, { ...rejected, state: "rejected" });

    await expect(
      approvePriceScenario(store, { organizationId: ORG, actorId: ACTOR, priceScenarioId }),
    ).rejects.toThrow(/cannot be approved from state rejected/);
    expect(store.priceScenarios.get(priceScenarioId)?.state).toBe("rejected");
  });

  it("rejects an unknown scenario and one from another organization", async () => {
    const store = new FakePriceScenarioStore();
    seedVariant(store);

    await expect(
      approvePriceScenario(store, {
        organizationId: ORG,
        actorId: ACTOR,
        priceScenarioId: "missing",
      }),
    ).rejects.toThrow(/price scenario not found/);

    const { priceScenarioId } = await seedDraft(store);
    await expect(
      approvePriceScenario(store, { organizationId: OTHER_ORG, actorId: ACTOR, priceScenarioId }),
    ).rejects.toThrow(/belongs to another organization/);
  });
});
