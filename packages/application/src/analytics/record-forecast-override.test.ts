import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { recordForecastOverride } from "./record-forecast-override";
import { FakeForecastStore } from "./test-support";
import type { ForecastSnapshotRecord } from "./read-types";
import type { ForecastGrain } from "./types";

const ORG = "org-1";

/** Seeds one snapshot so a `snapshotId` reference can be exercised. */
function seedSnapshot(
  store: FakeForecastStore,
  organizationId: string,
  grain: ForecastGrain = "day_location",
): Promise<ForecastSnapshotRecord> {
  return store.createForecastSnapshot({
    organizationId,
    metric: "revenue",
    grain,
    locationId: null,
    channelId: null,
    category: null,
    productVariantId: null,
    asOf: "2026-09-24T12:00:00.000Z",
    model: "least_squares_linear",
    projection: [{ period: "2026-09-25", value: "140.0000", lower: "130.0000", upper: "150.0000" }],
    accuracyMethod: null,
    accuracyMape: null,
    accuracyPoints: null,
    actorId: "actor-1",
  });
}

describe("recordForecastOverride", () => {
  it("appends a reasoned override and audits it", async () => {
    const store = new FakeForecastStore();

    const result = await recordForecastOverride(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      period: "2026-09-25",
      reason: "local festival distorted the day",
    });

    expect(store.overrides).toHaveLength(1);
    const override = store.overrides[0]!;
    expect(override.reason).toBe("local festival distorted the day");
    expect(override.period).toBe("2026-09-25");
    expect(override.actorId).toBe("actor-1");
    expect(result.forecastOverrideId).toBe(override.id);

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]!.action).toBe("analytics.forecast_override.recorded");
    expect(store.audits[0]!.entityType).toBe("forecast_override");
    expect(store.audits[0]!.reason).toBe("local festival distorted the day");
  });

  it("requires a reason", async () => {
    const store = new FakeForecastStore();
    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        period: "2026-09-25",
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.overrides).toHaveLength(0);
  });

  it("requires a period", async () => {
    const store = new FakeForecastStore();
    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        period: "",
        reason: "why",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses a grain this slice does not implement (DEC-011 ceiling)", async () => {
    const store = new FakeForecastStore();
    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location_product",
        period: "2026-09-25",
        reason: "why",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("appends a second override rather than replacing the first", async () => {
    const store = new FakeForecastStore();
    const base = {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue" as const,
      grain: "day_location" as const,
      period: "2026-09-25",
    };
    await recordForecastOverride(store, { ...base, reason: "first" });
    await recordForecastOverride(store, { ...base, reason: "second" });

    expect(store.overrides.map((override) => override.reason)).toEqual(["first", "second"]);
  });

  it("refuses a snapshotId recorded by another organization (DEC-061)", async () => {
    const store = new FakeForecastStore();
    const foreign = await seedSnapshot(store, "org-2");

    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        period: "2026-09-25",
        snapshotId: foreign.id,
        reason: "why",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.overrides).toHaveLength(0);
  });

  it("refuses a snapshotId whose grain differs from the override grain", async () => {
    const store = new FakeForecastStore();
    const mismatch = await seedSnapshot(store, ORG, "day_location_category");

    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        period: "2026-09-25",
        snapshotId: mismatch.id,
        reason: "why",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.overrides).toHaveLength(0);
  });

  it("refuses a period that is not a YYYY-MM-DD day bucket", async () => {
    const store = new FakeForecastStore();

    await expect(
      recordForecastOverride(store, {
        organizationId: ORG,
        actorId: "actor-1",
        metric: "revenue",
        grain: "day_location",
        period: "2026-6-1",
        reason: "why",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.overrides).toHaveLength(0);
  });

  it("links a same-organization, same-grain snapshotId and audits it", async () => {
    const store = new FakeForecastStore();
    const snapshot = await seedSnapshot(store, ORG);

    const result = await recordForecastOverride(store, {
      organizationId: ORG,
      actorId: "actor-1",
      metric: "revenue",
      grain: "day_location",
      period: "2026-09-25",
      snapshotId: snapshot.id,
      reason: "annotated the projection",
    });

    expect(store.overrides).toHaveLength(1);
    expect(store.overrides[0]!.snapshotId).toBe(snapshot.id);
    expect(result.forecastOverrideId).toBe(store.overrides[0]!.id);
    expect(store.audits).toHaveLength(1);
  });
});
