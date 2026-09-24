import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeReportingStore, type SalesGroupRow } from "../reporting";

import { computeForecast, FORECAST_METHOD } from "./forecast";

const ORG = "org-1";
const NOW = "2026-09-30T23:59:59.000Z";

function periodGroup(periodBucket: string, netSales: string, transactions = 10): SalesGroupRow {
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
    transactions,
    units: "10.000000",
    grossSales: netSales,
    netSales,
    taxAmount: "0.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "0.0000",
  };
}

function storeWith(...rows: readonly SalesGroupRow[]): FakeReportingStore {
  const store = new FakeReportingStore();
  for (const row of rows) {
    store.seedGroup(ORG, row);
  }
  return store;
}

describe("computeForecast", () => {
  it("fits a linear trend, projects it and states its method and error", async () => {
    const store = storeWith(
      periodGroup("2026-06", "100.0000"),
      periodGroup("2026-07", "110.0000"),
      periodGroup("2026-08", "120.0000"),
      periodGroup("2026-09", "130.0000"),
    );

    const forecast = await computeForecast(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      historyPeriods: 4,
      horizonPeriods: 2,
      now: NOW,
    });

    expect(forecast.status).toBe("ok");
    expect(forecast.method).toBe(FORECAST_METHOD);
    expect(forecast.model!.method).toBe("least_squares_linear");
    expect(forecast.model!.slopePerPeriod).toBe("10.0000");
    expect(forecast.model!.intercept).toBe("100.0000");
    expect(forecast.projection.map((point) => point.period)).toEqual(["2026-10", "2026-11"]);
    expect(forecast.projection[0]!.value).toBe("140.0000");
    expect(forecast.projection[1]!.value).toBe("150.0000");
    expect(forecast.projection[0]!.lower).toBe("140.0000");
    expect(forecast.accuracy!.mape).toBe("0.000000");
  });

  it("returns insufficient history when the window is shorter than three periods", async () => {
    const store = storeWith(periodGroup("2026-08", "120.0000"), periodGroup("2026-09", "130.0000"));

    const forecast = await computeForecast(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      historyPeriods: 2,
      horizonPeriods: 2,
      now: NOW,
    });

    expect(forecast.status).toBe("insufficient_history");
    expect(forecast.insufficient!.historyPoints).toBe(2);
    expect(forecast.projection).toEqual([]);
    expect(forecast.model).toBeNull();
  });

  it("returns insufficient history when a period has no computable value", async () => {
    const store = storeWith(
      periodGroup("2026-06", "0.0000", 0),
      periodGroup("2026-07", "0.0000", 0),
      periodGroup("2026-08", "0.0000", 0),
      periodGroup("2026-09", "0.0000", 0),
    );

    const forecast = await computeForecast(store, {
      organizationId: ORG,
      metric: "average_order_value",
      grain: "month",
      historyPeriods: 4,
      now: NOW,
    });

    expect(forecast.status).toBe("insufficient_history");
    expect(forecast.insufficient!.reason).toContain("no computable value");
  });

  it("reports a positive band and a positive error for a noisy history", async () => {
    const store = storeWith(
      periodGroup("2026-06", "100.0000"),
      periodGroup("2026-07", "120.0000"),
      periodGroup("2026-08", "110.0000"),
      periodGroup("2026-09", "140.0000"),
    );

    const forecast = await computeForecast(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "month",
      historyPeriods: 4,
      horizonPeriods: 1,
      now: NOW,
    });

    expect(forecast.status).toBe("ok");
    expect(Number(forecast.model!.confidence.bandScale)).toBeGreaterThan(0);
    expect(Number(forecast.accuracy!.mape)).toBeGreaterThan(0);
  });

  it("rejects an unknown metric", async () => {
    await expect(
      computeForecast(storeWith(), {
        organizationId: ORG,
        metric: "profit" as never,
        grain: "month",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
