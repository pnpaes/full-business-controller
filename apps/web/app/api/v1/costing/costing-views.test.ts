import type {
  CalculationSnapshotRecord,
  CostCardDetailRecord,
  CostCardRecord,
  PriceScenarioRecord,
  SnapshotComponentRecord,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  toAllocationRuleRows,
  toCostCardDetailView,
  toCostCardRows,
  toOperatingCostRows,
  toPriceScenarioRow,
  type CostingRefs,
} from "./costing-views";

const ORG = "org";
const OTHER = "org-other";

function refs(overrides: Partial<CostingRefs> = {}): CostingRefs {
  return {
    productVariants: new Map([
      ["v", { id: "v", organizationId: ORG, code: "FLAT", name: "Flat White" }],
    ]),
    locations: new Map([["l", { id: "l", organizationId: ORG, code: "MAIN", name: "Main" }]]),
    channels: new Map([["c", { id: "c", organizationId: ORG, code: "IN", name: "In store" }]]),
    costCenters: new Map([["cc", { id: "cc", organizationId: ORG, code: "KIT", name: "Kitchen" }]]),
    items: new Map([
      ["i", { id: "i", organizationId: ORG, code: "MILK", name: "Milk", baseUnitId: "u" }],
    ]),
    units: new Map([["u", { id: "u", organizationId: ORG, code: "l" }]]),
    ...overrides,
  };
}

function card(overrides: Partial<CostCardRecord> = {}): CostCardRecord {
  return {
    id: "card",
    organizationId: ORG,
    productVariantId: "v",
    locationId: "l",
    channelId: "c",
    recipeVersionId: null,
    state: "draft",
    costSelectionPolicy: "latest_approved_price",
    calculatedAt: "2026-09-01T08:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    snapshotId: "snap",
    ...overrides,
  };
}

function component(overrides: Partial<SnapshotComponentRecord> = {}): SnapshotComponentRecord {
  return {
    id: "comp",
    snapshotId: "snap",
    componentKind: "ingredient",
    itemId: "i",
    quantity: "0.018000",
    unitId: "u",
    unitCost: "326.6667",
    amount: "5.8800",
    roundingBoundary: "B3",
    provenance: {},
    ...overrides,
  };
}

function snapshot(totals: Record<string, unknown>): CalculationSnapshotRecord {
  return {
    id: "snap",
    organizationId: ORG,
    costCardId: "card",
    priceScenarioId: null,
    costSelectionPolicy: "latest_approved_price",
    asOf: "2026-09-01T08:00:00.000Z",
    taxRuleSnapshot: {},
    fxRateId: null,
    roundingMethod: "HALF_UP",
    roundingScales: {},
    ruleVersion: "v1",
    totals,
    createdAt: "2026-09-01T08:00:00.000Z",
  };
}

describe("costing view mapping", () => {
  it("maps cost cards with references and drops foreign-org rows", () => {
    const rows = toCostCardRows(
      ORG,
      [card(), card({ id: "foreign", organizationId: OTHER })],
      refs(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productVariantName: "Flat White",
      locationName: "Main",
      channelName: "In store",
    });
  });

  it("nulls a reference that belongs to another organization", () => {
    const foreign = refs({
      productVariants: new Map([
        ["v", { id: "v", organizationId: OTHER, code: "X", name: "Foreign" }],
      ]),
    });
    const [row] = toCostCardRows(ORG, [card()], foreign);
    expect(row?.productVariantName).toBeNull();
  });

  it("sums direct labour and overhead components into the totals view", () => {
    const detail: CostCardDetailRecord = {
      card: card(),
      snapshot: snapshot({
        currency: "NOK",
        unitVariableCost: "9.3348",
        unitFullCost: "12.3348",
        contributionAfterDirectLabor: "24.5782",
      }),
      components: [
        component({ id: "ing", componentKind: "ingredient", amount: "5.8800" }),
        component({
          id: "lab",
          componentKind: "direct_labor",
          amount: "2.5548",
          itemId: null,
          unitId: null,
        }),
        component({
          id: "oh",
          componentKind: "allocated_overhead",
          amount: "3.0000",
          itemId: null,
          unitId: null,
        }),
      ],
      history: [],
    };

    const view = toCostCardDetailView(ORG, detail, refs());
    expect(view.totals).toMatchObject({
      currency: "NOK",
      directLaborCost: "2.5548",
      allocatedUnitOverhead: "3.0000",
      unitFullCost: "12.3348",
    });
    expect(view.components.map((row) => row.componentKind)).toEqual([
      "ingredient",
      "direct_labor",
      "allocated_overhead",
    ]);
    expect(view.components[0]?.itemName).toBe("Milk");
    expect(view.components[0]?.unitCode).toBe("l");
  });

  it("returns a null totals view when the card has no snapshot", () => {
    const detail: CostCardDetailRecord = {
      card: card({ snapshotId: null }),
      snapshot: null,
      components: [],
      history: [],
    };
    const view = toCostCardDetailView(ORG, detail, refs());
    expect(view.snapshot).toBeNull();
    expect(view.totals).toBeNull();
  });

  it("flattens the stored scenario outcome onto the row", () => {
    const scenario: PriceScenarioRecord = {
      id: "s",
      organizationId: ORG,
      productVariantId: "v",
      locationId: "l",
      channelId: "c",
      grossPrice: "49.0000",
      netPrice: "39.2000",
      targetContributionPct: "0.300000",
      volumeAssumption: "100.000000",
      feeBreakdown: {},
      outcome: {
        presentedGrossPrice: "49.00",
        presentedNetPrice: "39.20",
        includedTax: "9.8000",
        unitVariableCost: "6.7800",
        channelVariableCost: "0.0000",
        unitContribution: "32.4200",
        contributionMarginPct: "0.827041",
        requiredGrossPrice: "8.4750",
        breakEvenUnits: "30.845157",
      },
      state: "draft",
      createdAt: "2026-09-01T08:00:00.000Z",
    };

    const row = toPriceScenarioRow(ORG, scenario, refs());
    expect(row).toMatchObject({
      productVariantName: "Flat White",
      presentedGrossPrice: "49.00",
      unitContribution: "32.4200",
      contributionMarginPct: "0.827041",
      breakEvenUnits: "30.845157",
      volumeAssumption: "100.000000",
    });
  });

  it("maps operating costs and allocation rules", () => {
    const costs = toOperatingCostRows(
      ORG,
      [
        {
          id: "oc",
          organizationId: ORG,
          locationId: "l",
          costCenterId: "cc",
          amount: "12500.0000",
          currency: "NOK",
          recurrence: "monthly",
          behavior: "fixed",
          taxBasis: "exclusive",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          vendor: "Demo Utilities AS",
          evidenceFileId: null,
        },
      ],
      refs(),
    );
    expect(costs[0]).toMatchObject({ costCenterName: "Kitchen", locationName: "Main" });

    const rules = toAllocationRuleRows([
      {
        id: "r",
        costPoolId: "p",
        costPoolCode: "DEMO_OVERHEAD",
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "production_hours",
        fallbackBehavior: "stop",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
    ]);
    expect(rules[0]?.costPoolCode).toBe("DEMO_OVERHEAD");
  });
});
