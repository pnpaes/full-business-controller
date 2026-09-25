import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import type { SalesGroupRow } from "../reporting";

import { recordForecastSnapshot } from "./record-forecast-snapshot";
import { FakeForecastStore } from "./test-support";

const ORG = "org-1";
const NOW = "2026-06-05T23:00:00.000Z";

function periodGroup(
  periodBucket: string,
  netSales: string,
  locationId: string | null = null,
): SalesGroupRow {
  return {
    key: periodBucket,
    label: periodBucket,
    locationId,
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

/** Four rising days so `computeForecast` fits and projects for the window anchor. */
function storeWithFourDays(locationId: string | null = null): FakeForecastStore {
  const store = new FakeForecastStore();
  const values = ["100.0000", "110.0000", "120.0000", "130.0000"];
  ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].forEach((period, index) => {
    store.seedGroup(ORG, periodGroup(period, values[index]!, locationId));
  });
  return store;
}

describe("recordForecastSnapshot", () => {
  it("records the current forecast as a day_location snapshot and audits it", async () => {
    const store = storeWithFourDays();

    const result = await recordForecastSnapshot(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      now: NOW,
    });

    expect(store.snapshots).toHaveLength(1);
    const snapshot = store.snapshots[0]!;
    expect(snapshot.grain).toBe("day_location");
    expect(snapshot.metric).toBe("revenue");
    expect(snapshot.model).toBe("least_squares_linear");
    expect(snapshot.projection.map((point) => point.period)).toEqual([
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
    ]);
    expect(snapshot.accuracyMethod).toBe("mape");
    expect(snapshot.accuracyPoints).toBe(4);
    expect(snapshot.locationId).toBeNull();

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]!.action).toBe("analytics.forecast_snapshot.recorded");
    expect(store.audits[0]!.entityType).toBe("forecast_snapshot");
    expect(result.forecastSnapshotId).toBe(snapshot.id);
  });

  it("captures the location scope", async () => {
    const store = storeWithFourDays("loc-1");

    await recordForecastSnapshot(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      locationId: "loc-1",
      now: NOW,
    });

    expect(store.snapshots[0]!.locationId).toBe("loc-1");
  });

  it("refuses an insufficient-history forecast rather than recording a projection-less snapshot", async () => {
    const store = new FakeForecastStore();
    store.seedGroup(ORG, periodGroup("2026-06-04", "120.0000"));
    store.seedGroup(ORG, periodGroup("2026-06-05", "130.0000"));

    await expect(
      recordForecastSnapshot(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        // Fewer real history windows than the minimum (3) so the forecast genuinely
        // returns insufficient_history instead of zero-filling up to the default 12.
        historyPeriods: 2,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.snapshots).toHaveLength(0);
  });

  it("refuses a grain this slice does not implement (DEC-011 ceiling)", async () => {
    const store = storeWithFourDays();
    await expect(
      recordForecastSnapshot(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location_category",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses a category on the day_location grain", async () => {
    const store = storeWithFourDays();
    await expect(
      recordForecastSnapshot(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        category: "pizza",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("requires the organization and actor", async () => {
    const store = storeWithFourDays();
    await expect(
      recordForecastSnapshot(store, {
        organizationId: "  ",
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordForecastSnapshot(store, {
        organizationId: ORG,
        actorId: "",
        metric: "revenue",
        grain: "day_location",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
