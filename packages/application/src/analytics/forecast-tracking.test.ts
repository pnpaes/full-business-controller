import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import type { SalesGroupRow } from "../reporting";

import { computeForecastTracking } from "./compute-forecast-tracking";
import { recordForecastOverride } from "./record-forecast-override";
import { recordForecastSnapshot } from "./record-forecast-snapshot";
import { FakeForecastStore } from "./test-support";

const ORG = "org-1";
const SNAPSHOT_NOW = "2026-06-05T23:00:00.000Z";

function periodGroup(periodBucket: string, netSales: string): SalesGroupRow {
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
    grossSales: netSales,
    netSales,
    taxAmount: "0.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "0.0000",
  };
}

/**
 * A store with four history days (rising 100→130) and the four projected days
 * seeded as their exact projected values (140→170), so a perfect forecast has a
 * zero MAPE.
 */
function storeWithHistoryAndActuals(): FakeForecastStore {
  const store = new FakeForecastStore();
  const days: [string, string][] = [
    ["2026-06-02", "100.0000"],
    ["2026-06-03", "110.0000"],
    ["2026-06-04", "120.0000"],
    ["2026-06-05", "130.0000"],
    ["2026-06-06", "140.0000"],
    ["2026-06-07", "150.0000"],
    ["2026-06-08", "160.0000"],
    ["2026-06-09", "170.0000"],
  ];
  for (const [period, netSales] of days) {
    store.seedGroup(ORG, periodGroup(period, netSales));
  }
  return store;
}

describe("computeForecastTracking", () => {
  it("reports no_snapshot honestly when the scope has no recorded snapshot", async () => {
    const store = new FakeForecastStore();

    const report = await computeForecastTracking(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "day_location",
      now: "2026-06-11T12:00:00.000Z",
    });

    expect(report.status).toBe("no_snapshot");
    expect(report.snapshotId).toBeNull();
    expect(report.periods).toEqual([]);
    expect(report.accuracy).toBeNull();
    expect(report.reason).toContain("no snapshot");
  });

  it("records a snapshot then tracks it against the seeded actuals (the joining test)", async () => {
    const store = storeWithHistoryAndActuals();
    await recordForecastSnapshot(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      now: SNAPSHOT_NOW,
      historyPeriods: 4,
      horizonPeriods: 4,
    });
    await recordForecastOverride(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      period: "2026-06-07",
      reason: "a local event moved the day",
    });

    const report = await computeForecastTracking(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "day_location",
      now: "2026-06-11T12:00:00.000Z",
    });

    expect(report.status).toBe("ok");
    expect(report.snapshotId).toBe(store.snapshots[0]!.id);
    expect(report.completedPeriods).toBe(4);
    expect(report.periods.map((period) => period.period)).toEqual([
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
    ]);
    expect(report.periods.map((period) => period.projected)).toEqual([
      "140.0000",
      "150.0000",
      "160.0000",
      "170.0000",
    ]);
    expect(report.periods.map((period) => period.actual)).toEqual([
      "140.0000",
      "150.0000",
      "160.0000",
      "170.0000",
    ]);
    expect(report.periods[0]!.absoluteError).toBe("0.0000");
    expect(report.periods[0]!.percentageError).toBe("0.000000");
    expect(report.accuracy!.mape).toBe("0.000000");
    expect(report.accuracy!.periods).toBe(4);
    expect(report.overrides).toHaveLength(1);
    expect(report.overrides[0]!.period).toBe("2026-06-07");
    expect(report.overrides[0]!.reason).toBe("a local event moved the day");
  });

  it("reports a positive MAPE when the actual differs from the projection", async () => {
    const store = new FakeForecastStore();
    const days: [string, string][] = [
      ["2026-06-02", "100.0000"],
      ["2026-06-03", "110.0000"],
      ["2026-06-04", "120.0000"],
      ["2026-06-05", "130.0000"],
      ["2026-06-06", "150.0000"],
      ["2026-06-07", "150.0000"],
      ["2026-06-08", "160.0000"],
      ["2026-06-09", "170.0000"],
    ];
    for (const [period, netSales] of days) {
      store.seedGroup(ORG, periodGroup(period, netSales));
    }
    await recordForecastSnapshot(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      now: SNAPSHOT_NOW,
      historyPeriods: 4,
      horizonPeriods: 4,
    });

    const report = await computeForecastTracking(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "day_location",
      now: "2026-06-11T12:00:00.000Z",
    });

    expect(report.status).toBe("ok");
    expect(report.periods[0]!.projected).toBe("140.0000");
    expect(report.periods[0]!.actual).toBe("150.0000");
    expect(report.periods[0]!.absoluteError).toBe("10.0000");
    expect(report.periods[0]!.percentageError).toBe("0.066667");
    // (10/150) / 4 = 0.016666… → 0.016667 at 6 dp.
    expect(report.accuracy!.mape).toBe("0.016667");
  });

  it("withholds the accuracy below four completed periods", async () => {
    const store = storeWithHistoryAndActuals();
    await recordForecastSnapshot(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      now: SNAPSHOT_NOW,
      historyPeriods: 4,
      horizonPeriods: 4,
    });

    const report = await computeForecastTracking(store, {
      organizationId: ORG,
      metric: "revenue",
      grain: "day_location",
      now: "2026-06-08T12:00:00.000Z",
    });

    expect(report.status).toBe("insufficient_history");
    expect(report.completedPeriods).toBe(2);
    expect(report.accuracy).toBeNull();
    expect(report.minimumCompletedPeriods).toBe(4);
    expect(report.reason).toContain("at least 4");
  });

  it("refuses a grain this slice does not implement (DEC-011 ceiling)", async () => {
    const store = new FakeForecastStore();
    await expect(
      computeForecastTracking(store, {
        organizationId: ORG,
        metric: "revenue",
        grain: "day_location_product",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
