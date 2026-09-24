import { describe, expect, it } from "vitest";

import { FakeReportingStore, type SalesGroupRow } from "../reporting";

import {
  belowPeerMedianSuggestions,
  computeSuggestions,
  contributionDecliningSuggestion,
  revenueDecliningSuggestion,
  thinContributionSuggestions,
  wasteRisingSuggestion,
  yieldFallingSuggestion,
} from "./suggestions";
import type { BenchmarkReport, TrendPoint, TrendSeries } from "./types";

const ORG = "org-1";

function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    period: "2026-09",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.000Z",
    value: "90.0000",
    previousValue: "120.0000",
    absoluteChange: "-30.0000",
    relativeChange: "-0.250000",
    direction: "down",
    ...overrides,
  };
}

function trend(overrides: Partial<TrendSeries> = {}): TrendSeries {
  return {
    asOf: "2026-09-30T23:59:59.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    grain: "month",
    scope: { locationIds: null, channelId: null },
    method: "test",
    flatBandFraction: "0.050000",
    points: [
      point({ direction: null, previousValue: null, absoluteChange: null, relativeChange: null }),
      point(),
    ],
    notes: [],
    ...overrides,
  };
}

describe("trend direction rules", () => {
  it("fires revenue-declining on a down latest period", () => {
    const suggestion = revenueDecliningSuggestion(trend());
    expect(suggestion?.ruleId).toBe("R-REVENUE-DECLINING");
    expect(suggestion?.severity).toBe("medium");
    expect(suggestion?.advisory).toBe(true);
    expect(suggestion?.evidence.some((item) => item.label === "relative change")).toBe(true);
  });

  it("does not fire revenue-declining when the latest period is flat or up", () => {
    expect(
      revenueDecliningSuggestion(trend({ points: [point({ direction: "flat" })] })),
    ).toBeNull();
    expect(revenueDecliningSuggestion(trend({ points: [point({ direction: "up" })] }))).toBeNull();
    expect(revenueDecliningSuggestion(trend({ points: [] }))).toBeNull();
  });

  it("fires contribution-declining at high severity", () => {
    const suggestion = contributionDecliningSuggestion(
      trend({ metric: "contribution", metricLabel: "Contribution before labour" }),
    );
    expect(suggestion?.ruleId).toBe("R-CONTRIBUTION-DECLINING");
    expect(suggestion?.severity).toBe("high");
  });

  it("fires waste-rising on an up latest period and not on a down one", () => {
    expect(wasteRisingSuggestion(trend({ points: [point({ direction: "up" })] }))?.ruleId).toBe(
      "R-WASTE-RISING",
    );
    expect(wasteRisingSuggestion(trend())).toBeNull();
  });

  it("fires yield-falling on a down latest period and not on an up one", () => {
    expect(yieldFallingSuggestion(trend())?.ruleId).toBe("R-YIELD-FALLING");
    expect(yieldFallingSuggestion(trend({ points: [point({ direction: "up" })] }))).toBeNull();
  });
});

function benchmarkEntity(
  overrides: Partial<BenchmarkReport["entities"][number]>,
): BenchmarkReport["entities"][number] {
  return {
    entityId: "loc-1",
    label: "Location 1",
    isUnmapped: false,
    value: "100.0000",
    rank: 3,
    ratioToOrganization: "0.166667",
    ratioToPeerMedian: "0.500000",
    meetsPeerMedian: false,
    ...overrides,
  };
}

function benchmark(entities: BenchmarkReport["entities"]): BenchmarkReport {
  return {
    asOf: "2026-09-30T23:59:59.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    dimension: "location",
    dimensionLabel: "Location",
    period: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.000Z" },
    scope: { locationIds: null, channelId: null },
    basis: "internal",
    basisNote: "test",
    organizationAggregate: "600.0000",
    peerMedian: "200.0000",
    entities,
    notes: [],
  };
}

describe("belowPeerMedianSuggestions", () => {
  it("fires for an entity more than the threshold below the median", () => {
    const suggestions = belowPeerMedianSuggestions(benchmark([benchmarkEntity({})]));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.ruleId).toBe("R-BELOW-PEER-MEDIAN");
    expect(suggestions[0]!.subject.kind).toBe("location");
  });

  it("does not fire within the threshold or for the unmapped bucket", () => {
    expect(
      belowPeerMedianSuggestions(benchmark([benchmarkEntity({ ratioToPeerMedian: "0.900000" })])),
    ).toHaveLength(0);
    expect(
      belowPeerMedianSuggestions(
        benchmark([benchmarkEntity({ isUnmapped: true, ratioToPeerMedian: "0.100000" })]),
      ),
    ).toHaveLength(0);
  });

  it("does not fire when the median is zero or undefined", () => {
    expect(belowPeerMedianSuggestions(benchmark([benchmarkEntity({})]))).toHaveLength(1);
    const zeroMedian = { ...benchmark([benchmarkEntity({})]), peerMedian: "0.0000" };
    expect(belowPeerMedianSuggestions(zeroMedian)).toHaveLength(0);
  });
});

function productRow(overrides: Partial<SalesGroupRow> = {}): SalesGroupRow {
  return {
    key: "variant-1",
    label: "Flat white",
    locationId: null,
    channelId: null,
    category: "coffee",
    productVariantId: "variant-1",
    productKind: "menu_item",
    optionKinds: [],
    periodBucket: "2026-09",
    transactions: 1,
    units: "1.000000",
    grossSales: "100.0000",
    netSales: "100.0000",
    taxAmount: "0.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "30.0000",
    ...overrides,
  };
}

describe("thinContributionSuggestions", () => {
  it("fires high for a negative contribution and medium for a thin margin", () => {
    const suggestions = thinContributionSuggestions([
      productRow({ key: "neg", productVariantId: "neg", ingredientCost: "120.0000" }),
      productRow({ key: "thin", productVariantId: "thin", ingredientCost: "95.0000" }),
      productRow({ key: "ok", productVariantId: "ok", ingredientCost: "30.0000" }),
    ]);
    expect(suggestions.map((suggestion) => suggestion.subject.id)).toEqual(["neg", "thin"]);
    expect(suggestions[0]!.severity).toBe("high");
    expect(suggestions[1]!.severity).toBe("medium");
  });

  it("does not fire for a healthy product or the unmapped bucket", () => {
    const suggestions = thinContributionSuggestions([
      productRow({ key: "unmapped", productVariantId: null, ingredientCost: "120.0000" }),
      productRow({ key: "ok", productVariantId: "ok", ingredientCost: "30.0000" }),
    ]);
    expect(suggestions).toHaveLength(0);
  });
});

describe("computeSuggestions", () => {
  it("gathers the facts, applies every rule and states the advisory posture", async () => {
    const store = new FakeReportingStore();
    const rows: readonly [string, string][] = [
      ["2026-06", "200.0000"],
      ["2026-07", "180.0000"],
      ["2026-08", "150.0000"],
      ["2026-09", "100.0000"],
    ];
    for (const [bucket, netSales] of rows) {
      store.seedGroup(
        ORG,
        productRow({
          key: bucket,
          productVariantId: null,
          label: bucket,
          periodBucket: bucket,
          netSales,
        }),
      );
    }

    const report = await computeSuggestions(store, {
      organizationId: ORG,
      period: { from: "2026-06-01T00:00:00.000Z", to: "2026-09-30T23:59:59.000Z" },
    });

    expect(report.posture).toBe("advisory_only");
    expect(report.evaluated).toHaveLength(6);
    expect(report.suggestions.map((suggestion) => suggestion.ruleId)).toContain(
      "R-REVENUE-DECLINING",
    );
    for (const suggestion of report.suggestions) {
      expect(suggestion.advisory).toBe(true);
      expect(suggestion.evidence.length).toBeGreaterThan(0);
      expect(suggestion.action.length).toBeGreaterThan(0);
    }
  });
});
