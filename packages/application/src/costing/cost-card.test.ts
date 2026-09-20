import { describe, expect, it } from "vitest";

import { approveCostCard, calculateCostCard, COST_CARD_AUDIT_ACTIONS } from "./cost-card";
import { FakeCostCardStore } from "./cost-card-test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";
const VARIANT = "variant-1";
const LOCATION = "location-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");

/** The `cheese_bun` golden fixture's per-portion composition (illustrative figures). */
const CHEESE_BUN = {
  currency: "NOK",
  ingredientCost: "5.8800",
  packagingCost: "0.9000",
  directLaborCost: "2.5548",
  channelVariableCost: "0.0000",
  otherVariableCost: "0.0000",
  unitNetSales: "33.9130",
  allocatedUnitOverhead: "0.0000",
} as const;

function seedVariant(store: FakeCostCardStore, id = VARIANT, organizationId = ORG): string {
  store.productVariants.set(id, { id, organizationId });
  return id;
}

function seedLocation(store: FakeCostCardStore, id = LOCATION, organizationId = ORG): string {
  store.locations.set(id, { id, organizationId });
  return id;
}

function calculateInput(overrides: Partial<Parameters<typeof calculateCostCard>[1]> = {}) {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    productVariantId: VARIANT,
    locationId: LOCATION,
    costSelectionPolicy: "latest_approved_price",
    asOf: AS_OF,
    ruleVersion: "calc-v1",
    composition: CHEESE_BUN,
    ...overrides,
  };
}

describe("calculateCostCard", () => {
  it("computes the cheese-bun totals and records the calculation snapshot and audit", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store);

    const result = await calculateCostCard(
      store,
      calculateInput({
        components: [
          { componentKind: "ingredient", amount: "5.8800", roundingBoundary: "B3" },
          { componentKind: "packaging", amount: "0.9000" },
          { componentKind: "direct_labor", amount: "2.5548" },
        ],
      }),
    );

    expect(result.totals.contributionAfterDirectLabor).toBe("24.5782");
    expect(result.totals.unitVariableCost).toBe("9.3348");

    const card = store.costCards.get(result.costCardId);
    expect(card).toMatchObject({
      state: "draft",
      snapshotId: result.snapshotId,
      channelId: null,
      recipeVersionId: null,
    });

    const snapshot = store.snapshots.find((row) => row.id === result.snapshotId);
    expect(snapshot).toMatchObject({
      costCardId: result.costCardId,
      priceScenarioId: null,
      roundingMethod: "HALF_UP",
      ruleVersion: "calc-v1",
      roundingScales: { qty: 6, money: 4, presented: 2 },
    });
    expect(snapshot?.totals).toMatchObject({ contributionAfterDirectLabor: "24.5782" });
    expect(snapshot?.asOf).toBe(AS_OF.toISOString());

    const components = await store.listSnapshotComponents(result.snapshotId);
    expect(components.map((component) => component.componentKind).sort()).toEqual([
      "direct_labor",
      "ingredient",
      "packaging",
    ]);
    expect(components.find((c) => c.componentKind === "ingredient")?.roundingBoundary).toBe("B3");

    expect(store.audits).toEqual([
      expect.objectContaining({
        action: COST_CARD_AUDIT_ACTIONS.calculated,
        entityType: "cost_card",
        entityId: result.costCardId,
        after: {
          snapshot_id: result.snapshotId,
          state: "draft",
          cost_selection_policy: "latest_approved_price",
        },
      }),
    ]);
  });

  it("rejects a component with an unknown componentKind before opening a transaction", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);

    await expect(
      calculateCostCard(store, calculateInput({ components: [{ componentKind: "not_a_kind" }] })),
    ).rejects.toThrow(/componentKind must be one of/);
    expect(store.costCards.size).toBe(0);
  });

  it("rejects a product variant that belongs to another organization", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store, VARIANT, OTHER_ORG);

    await expect(calculateCostCard(store, calculateInput())).rejects.toThrow(
      /product variant belongs to another organization/,
    );
    expect(store.costCards.size).toBe(0);
  });

  it("rejects a missing location", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);

    await expect(calculateCostCard(store, calculateInput())).rejects.toThrow(/location not found/);
    expect(store.costCards.size).toBe(0);
  });

  it("rejects a location that belongs to another organization", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store, LOCATION, OTHER_ORG);

    await expect(calculateCostCard(store, calculateInput())).rejects.toThrow(
      /location belongs to another organization/,
    );
    expect(store.costCards.size).toBe(0);
  });

  it("rejects a channel that belongs to another organization", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store);
    store.channels.set("channel-1", { id: "channel-1", organizationId: OTHER_ORG });

    await expect(
      calculateCostCard(store, calculateInput({ channelId: "channel-1" })),
    ).rejects.toThrow(/channel belongs to another organization/);
    expect(store.costCards.size).toBe(0);
  });

  it("rejects a recipe version that belongs to another organization", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store);
    store.recipeVersions.set("recipe-version-1", {
      id: "recipe-version-1",
      organizationId: OTHER_ORG,
    });

    await expect(
      calculateCostCard(store, calculateInput({ recipeVersionId: "recipe-version-1" })),
    ).rejects.toThrow(/recipe version belongs to another organization/);
    expect(store.costCards.size).toBe(0);
  });
});

describe("approveCostCard", () => {
  it("approves a card and supersedes the previously approved card in scope", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store);

    const first = await calculateCostCard(store, calculateInput());
    const second = await calculateCostCard(store, calculateInput());

    const firstApproval = await approveCostCard(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCardId: first.costCardId,
      approvedBy: "approver-1",
      approvedAt: new Date("2026-06-02T00:00:00Z"),
    });
    expect(firstApproval).toEqual({
      costCardId: first.costCardId,
      state: "approved",
      supersededCostCardIds: [],
    });

    const secondApproval = await approveCostCard(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCardId: second.costCardId,
      approvedBy: "approver-1",
    });
    expect(secondApproval).toEqual({
      costCardId: second.costCardId,
      state: "approved",
      supersededCostCardIds: [first.costCardId],
    });

    expect(store.costCards.get(first.costCardId)?.state).toBe("superseded");
    expect(store.costCards.get(second.costCardId)).toMatchObject({
      state: "approved",
      approvedBy: "approver-1",
    });
    expect(store.audits.map((audit) => audit.action)).toEqual([
      COST_CARD_AUDIT_ACTIONS.calculated,
      COST_CARD_AUDIT_ACTIONS.calculated,
      COST_CARD_AUDIT_ACTIONS.approved,
      COST_CARD_AUDIT_ACTIONS.superseded,
      COST_CARD_AUDIT_ACTIONS.approved,
    ]);
  });

  it("rejects an already-approved card", async () => {
    const store = new FakeCostCardStore();
    seedVariant(store);
    seedLocation(store);
    const { costCardId } = await calculateCostCard(store, calculateInput());
    await approveCostCard(store, {
      organizationId: ORG,
      actorId: ACTOR,
      costCardId,
      approvedBy: "approver-1",
    });

    await expect(
      approveCostCard(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCardId,
        approvedBy: "approver-2",
      }),
    ).rejects.toThrow(/already approved/);
  });

  it("rejects a card with no calculation snapshot", async () => {
    const store = new FakeCostCardStore();
    const draft = await store.createCostCard({
      organizationId: ORG,
      productVariantId: VARIANT,
      locationId: LOCATION,
      channelId: null,
      recipeVersionId: null,
      costSelectionPolicy: "latest_approved_price",
    });

    await expect(
      approveCostCard(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCardId: draft.id,
        approvedBy: "approver-1",
      }),
    ).rejects.toThrow(/no calculation snapshot/);
  });

  it("rejects a cost card that does not exist", async () => {
    const store = new FakeCostCardStore();

    await expect(
      approveCostCard(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCardId: "missing",
        approvedBy: "approver-1",
      }),
    ).rejects.toThrow(/cost card not found/);
  });

  it("rejects a card that belongs to another organization", async () => {
    const store = new FakeCostCardStore();
    const foreign = await store.createCostCard({
      organizationId: OTHER_ORG,
      productVariantId: VARIANT,
      locationId: LOCATION,
      channelId: null,
      recipeVersionId: null,
      costSelectionPolicy: "latest_approved_price",
    });

    await expect(
      approveCostCard(store, {
        organizationId: ORG,
        actorId: ACTOR,
        costCardId: foreign.id,
        approvedBy: "approver-1",
      }),
    ).rejects.toThrow(/belongs to another organization/);
  });
});
