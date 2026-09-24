import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeReportingStore, type SalesGroupRow } from "../reporting";

import { computeTrends, TREND_METHOD } from "./trends";

const ORG = "org-1";
const NOW = "2026-09-30T23:59:59.000Z";

function periodGroup(periodBucket: string, overrides: Partial<SalesGroupRow> = {}): SalesGroupRow {
  return {
    key: periodBucket,
    label: periodBucket,
    locationId: null,
    channelId: null,
    category: null,
    productVariantId: null,
    productKind: null,
    optionKinds: [],
    periodBucket,
    transactions: 10,
    units: "10.000000",
    grossSales: "125.0000",
    netSales: "100.0000",
    taxAmount: "25.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "0.0000",
    ...overrides,
  };
}

function storeWith(...rows: readonly SalesGroupRow[]): FakeReportingStore {
  const store = new FakeReportingStore();
  for (const row of rows) {
    store.seedGroup(ORG, row);
  }
  return store;
}

describe("computeTrends", () => {
  it("computes a period-over-period series with directions", async () => {
    const store = storeWith(
      periodGroup("2026-07", { netSales: "100.0000" }),
      periodGroup("2026-08", { netSales: "120.0000" }),
      periodGroup("2026-09", { netSales: "90.0000" }),
    );

    const trend = await computeTrends(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      periods: 3,
      now: NOW,
    });

    expect(trend.points.map((point) => point.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(trend.method).toBe(TREND_METHOD);
    expect(trend.points[0]!.direction).toBeNull();
    expect(trend.points[1]!.direction).toBe("up");
    expect(trend.points[1]!.absoluteChange).toBe("20.0000");
    expect(trend.points[1]!.relativeChange).toBe("0.200000");
    expect(trend.points[2]!.direction).toBe("down");
    expect(trend.points[2]!.absoluteChange).toBe("-30.0000");
  });

  it("reads a change inside the flat band as flat", async () => {
    const store = storeWith(
      periodGroup("2026-08", { netSales: "100.0000" }),
      periodGroup("2026-09", { netSales: "102.0000" }),
    );

    const trend = await computeTrends(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      periods: 2,
      now: NOW,
    });

    expect(trend.points[1]!.direction).toBe("flat");
    expect(trend.flatBandFraction).toBe("0.050000");
  });

  it("carries null for an undefined period value and its comparison", async () => {
    const store = storeWith(
      periodGroup("2026-08", { transactions: 0 }),
      periodGroup("2026-09", { transactions: 0 }),
    );

    const trend = await computeTrends(store, {
      organizationId: ORG,
      metric: "average_order_value",
      grain: "month",
      periods: 2,
      now: NOW,
    });

    expect(trend.points[0]!.value).toBeNull();
    expect(trend.points[1]!.value).toBeNull();
    expect(trend.points[1]!.direction).toBeNull();
    expect(trend.points[1]!.absoluteChange).toBeNull();
  });

  it("treats a period with no rows as a genuine zero for a sum metric", async () => {
    const store = storeWith(periodGroup("2026-09", { netSales: "50.0000" }));

    const trend = await computeTrends(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      periods: 2,
      now: NOW,
    });

    expect(trend.points[0]!.period).toBe("2026-08");
    expect(trend.points[0]!.value).toBe("0.0000");
    expect(trend.points[1]!.direction).toBe("up");
  });

  it("rejects an unknown metric and grain", async () => {
    const store = storeWith();
    await expect(
      computeTrends(store, {
        organizationId: ORG,
        metric: "profit" as never,
        grain: "month",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      computeTrends(store, {
        organizationId: ORG,
        metric: "revenue",
        grain: "quarter" as never,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
