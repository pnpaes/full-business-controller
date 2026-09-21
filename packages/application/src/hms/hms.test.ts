import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { findMonitoringPoint } from "./find-monitoring-point";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerMonitoringPoint } from "./register-monitoring-point";
import type { RegisterMonitoringPointInput } from "./register-monitoring-point";
import { FakeHmsStore, seedHmsFixture, type HmsFixture } from "./test-support";
import type { MonitoringPointRecord } from "./types";
import { updateMonitoringPoint } from "./update-monitoring-point";
import type { UpdateMonitoringPointInput } from "./update-monitoring-point";

function setup(): { store: FakeHmsStore; fixture: HmsFixture } {
  const store = new FakeHmsStore();
  return { store, fixture: seedHmsFixture() };
}

function registerFridge(
  store: FakeHmsStore,
  fixture: HmsFixture,
  overrides: Partial<RegisterMonitoringPointInput> = {},
): Promise<MonitoringPointRecord> {
  return registerMonitoringPoint(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    locationId: fixture.locationId,
    code: "fridge-1",
    name: "Walk-in fridge",
    kind: "refrigerator",
    unit: "celsius",
    targetMin: "0",
    targetMax: "4",
    checkFrequency: "twice_daily",
    ...overrides,
  });
}

function updateFridge(
  store: FakeHmsStore,
  fixture: HmsFixture,
  point: MonitoringPointRecord,
  overrides: Partial<UpdateMonitoringPointInput> = {},
): Promise<MonitoringPointRecord> {
  return updateMonitoringPoint(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    monitoringPointId: point.id,
    ...overrides,
  });
}

describe("registerMonitoringPoint", () => {
  it("registers a point and writes its audit fact", async () => {
    const { store, fixture } = setup();

    const point = await registerFridge(store, fixture);

    expect(point).toMatchObject({
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      storageAreaId: null,
      code: "fridge-1",
      name: "Walk-in fridge",
      kind: "refrigerator",
      unit: "celsius",
      targetMin: "0.000000",
      targetMax: "4.000000",
      checkFrequency: "twice_daily",
      active: true,
      createdBy: fixture.actorId,
    });
    expect(store.monitoringPoints.size).toBe(1);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      action: "hms.monitoring_point.created",
      entityType: "monitoring_point",
      entityId: point.id,
    });
  });

  it("rejects an inverted target range and writes nothing", async () => {
    const { store, fixture } = setup();

    await expect(
      registerFridge(store, fixture, { targetMin: "5", targetMax: "0" }),
    ).rejects.toThrow(DomainError);
    expect(store.monitoringPoints.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects an unknown kind or check frequency and blank required text", async () => {
    const { store, fixture } = setup();

    await expect(registerFridge(store, fixture, { kind: "microwave" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerFridge(store, fixture, { checkFrequency: "hourly" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerFridge(store, fixture, { code: "  " })).rejects.toThrow(DomainError);
    await expect(registerFridge(store, fixture, { unit: "" })).rejects.toThrow(DomainError);
    expect(store.monitoringPoints.size).toBe(0);
  });
});

describe("updateMonitoringPoint", () => {
  it("corrects a point's name and target range and audits before/after", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture);

    const updated = await updateFridge(store, fixture, point, {
      name: "Walk-in fridge (front)",
      targetMin: "-1",
      targetMax: "5",
    });

    expect(updated).toMatchObject({
      id: point.id,
      code: "fridge-1",
      name: "Walk-in fridge (front)",
      targetMin: "-1.000000",
      targetMax: "5.000000",
      active: true,
    });
    expect(store.monitoringPoints.get(point.id)?.name).toBe("Walk-in fridge (front)");

    const audits = store.audits.filter((audit) => audit.action === "hms.monitoring_point.updated");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "monitoring_point",
      entityId: point.id,
    });
    // Only the patched fields are captured, in the create fact's snake_case.
    expect(audits[0]?.before).toEqual({
      name: "Walk-in fridge",
      target_min: "0.000000",
      target_max: "4.000000",
    });
    expect(audits[0]?.after).toEqual({
      name: "Walk-in fridge (front)",
      target_min: "-1.000000",
      target_max: "5.000000",
    });
  });

  it("deactivates a point and keeps its stored readings", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture);
    const reading = await recordMonitoringReading(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: point.id,
      value: "2",
      measuredAt: "2026-02-01T08:00:00.000Z",
    });

    const updated = await updateFridge(store, fixture, point, { active: false });

    expect(updated.active).toBe(false);
    expect(
      await listMonitoringPoints(store, { organizationId: fixture.organizationId }),
    ).toHaveLength(1);
    expect(
      await listMonitoringPoints(store, {
        organizationId: fixture.organizationId,
        activeOnly: true,
      }),
    ).toHaveLength(0);
    expect(store.monitoringReadings.has(reading.id)).toBe(true);

    const audit = store.audits.find((row) => row.action === "hms.monitoring_point.updated");
    expect(audit?.before).toEqual({ active: true });
    expect(audit?.after).toEqual({ active: false });
  });

  it("rejects an inverted range, unknown vocabulary and blank text without writing", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture);

    await expect(
      updateFridge(store, fixture, point, { targetMin: "5", targetMax: "1" }),
    ).rejects.toThrow(DomainError);
    // A single patched bound is checked against the stored other one.
    await expect(updateFridge(store, fixture, point, { targetMin: "9" })).rejects.toThrow(
      DomainError,
    );
    await expect(updateFridge(store, fixture, point, { kind: "microwave" })).rejects.toThrow(
      DomainError,
    );
    await expect(updateFridge(store, fixture, point, { checkFrequency: "hourly" })).rejects.toThrow(
      DomainError,
    );
    await expect(updateFridge(store, fixture, point, { name: "  " })).rejects.toThrow(DomainError);
    await expect(updateFridge(store, fixture, point, { unit: "" })).rejects.toThrow(DomainError);
    await expect(updateFridge(store, fixture, point, {})).rejects.toThrow(DomainError);

    expect(store.monitoringPoints.get(point.id)).toMatchObject({
      name: "Walk-in fridge",
      kind: "refrigerator",
      unit: "celsius",
      targetMin: "0.000000",
      targetMax: "4.000000",
      active: true,
    });
    expect(
      store.audits.filter((audit) => audit.action === "hms.monitoring_point.updated"),
    ).toHaveLength(0);
  });

  it("reports an unknown or cross-organization point as NotFoundError", async () => {
    const { store, fixture } = setup();
    await registerFridge(store, fixture);
    const otherPoint = await registerMonitoringPoint(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      locationId: fixture.otherLocationId,
      code: "freezer-1",
      name: "Chest freezer",
      kind: "freezer",
      unit: "celsius",
      targetMin: "-20",
      targetMax: "-15",
      checkFrequency: "daily",
    });

    await expect(
      updateMonitoringPoint(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        monitoringPointId: "missing",
        name: "Nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      updateMonitoringPoint(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        monitoringPointId: otherPoint.id,
        name: "Nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.monitoringPoints.get(otherPoint.id)?.name).toBe("Chest freezer");
    expect(
      store.audits.filter((audit) => audit.action === "hms.monitoring_point.updated"),
    ).toHaveLength(0);
  });
});

describe("recordMonitoringReading", () => {
  it("persists in-range and out-of-range readings with the point's unit", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture, {
      unit: "fahrenheit",
      targetMin: "0",
      targetMax: "4",
    });

    const inRange = await recordMonitoringReading(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: point.id,
      value: "4",
      measuredAt: "2026-02-01T08:00:00.000Z",
    });
    const outOfRange = await recordMonitoringReading(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: point.id,
      value: "9.5",
      measuredAt: "2026-02-01T12:00:00.000Z",
      notes: "door left open",
    });

    // The upper bound is inclusive, so a reading at exactly `targetMax` is in range.
    expect(inRange).toMatchObject({
      organizationId: fixture.organizationId,
      monitoringPointId: point.id,
      value: "4.000000",
      unit: "fahrenheit",
      measuredAt: "2026-02-01T08:00:00.000Z",
      recordedBy: fixture.actorId,
      inRange: true,
      notes: null,
    });
    expect(outOfRange).toMatchObject({
      value: "9.500000",
      inRange: false,
      notes: "door left open",
    });
    expect(store.monitoringReadings.size).toBe(2);

    const readings = await listMonitoringReadings(store, {
      organizationId: fixture.organizationId,
    });
    expect(readings.map((reading) => reading.id)).toEqual([outOfRange.id, inRange.id]);

    const audits = store.audits.filter(
      (audit) => audit.action === "hms.monitoring_reading.recorded",
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "monitoring_reading",
      entityId: inRange.id,
      after: { unit: "fahrenheit", in_range: true },
    });
    expect(audits[1]).toMatchObject({ entityId: outOfRange.id, after: { in_range: false } });
  });

  it("reports an unknown or cross-organization point as NotFoundError", async () => {
    const { store, fixture } = setup();
    const unknown = {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: "missing",
      value: "1",
      measuredAt: "2026-02-01T08:00:00.000Z",
    };
    await expect(recordMonitoringReading(store, unknown)).rejects.toThrow(NotFoundError);

    const otherPoint = await registerMonitoringPoint(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      locationId: fixture.otherLocationId,
      code: "freezer-1",
      name: "Chest freezer",
      kind: "freezer",
      unit: "celsius",
      targetMin: "-20",
      targetMax: "-15",
      checkFrequency: "daily",
    });
    await expect(
      recordMonitoringReading(store, { ...unknown, monitoringPointId: otherPoint.id }),
    ).rejects.toThrow(NotFoundError);
    expect(store.monitoringReadings.size).toBe(0);
  });
});

describe("monitoring queries", () => {
  it("scopes both reads to the organization and filters points", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture);
    const hotPoint = await registerMonitoringPoint(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      locationId: "loc-kitchen",
      code: "hot-1",
      name: "Hot holding",
      kind: "hot_holding",
      unit: "celsius",
      targetMin: "63",
      targetMax: "90",
      checkFrequency: "twice_daily",
    });
    const otherPoint = await registerMonitoringPoint(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      locationId: fixture.otherLocationId,
      code: "freezer-1",
      name: "Chest freezer",
      kind: "freezer",
      unit: "celsius",
      targetMin: "-20",
      targetMax: "-15",
      checkFrequency: "daily",
    });
    await recordMonitoringReading(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: point.id,
      value: "2",
      measuredAt: "2026-02-01T08:00:00.000Z",
    });
    const otherReading = await recordMonitoringReading(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      monitoringPointId: otherPoint.id,
      value: "-18",
      measuredAt: "2026-02-01T08:00:00.000Z",
    });

    const own = await listMonitoringPoints(store, { organizationId: fixture.organizationId });
    expect(own.map((row) => row.id)).toEqual([point.id, hotPoint.id]);

    const here = await listMonitoringPoints(store, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
    });
    expect(here.map((row) => row.id)).toEqual([point.id]);

    expect(
      await listMonitoringPoints(store, { organizationId: fixture.otherOrganizationId }),
    ).toHaveLength(1);
    const ownReadings = await listMonitoringReadings(store, {
      organizationId: fixture.organizationId,
    });
    expect(ownReadings).toHaveLength(1);
    expect(ownReadings[0]?.id).not.toBe(otherReading.id);
    expect(
      await listMonitoringReadings(store, {
        organizationId: fixture.otherOrganizationId,
        monitoringPointId: point.id,
      }),
    ).toHaveLength(0);

    expect(
      (
        await findMonitoringPoint(store, {
          organizationId: fixture.organizationId,
          monitoringPointId: point.id,
        })
      )?.id,
    ).toBe(point.id);
    expect(
      await findMonitoringPoint(store, {
        organizationId: fixture.organizationId,
        monitoringPointId: otherPoint.id,
      }),
    ).toBeUndefined();
    expect(
      await findMonitoringPoint(store, {
        organizationId: fixture.otherOrganizationId,
        monitoringPointId: point.id,
      }),
    ).toBeUndefined();
  });
});

describe("FakeHmsStore.withTransaction", () => {
  it("rolls back point, reading and audit writes when the callback throws", async () => {
    const { store, fixture } = setup();
    const existing = await registerFridge(store, fixture);

    const baseline = {
      monitoringPoints: store.monitoringPoints.size,
      monitoringReadings: store.monitoringReadings.size,
      audits: store.audits.length,
    };

    await expect(
      store.withTransaction(async (tx) => {
        const point = await tx.createMonitoringPoint({
          organizationId: fixture.organizationId,
          locationId: fixture.locationId,
          storageAreaId: null,
          code: "fridge-2",
          name: "Back-up fridge",
          kind: "refrigerator",
          unit: "celsius",
          targetMin: "0.000000",
          targetMax: "4.000000",
          checkFrequency: "twice_daily",
          createdBy: fixture.actorId,
        });
        await tx.recordMonitoringReading({
          organizationId: fixture.organizationId,
          monitoringPointId: point.id,
          value: "2.000000",
          unit: "celsius",
          measuredAt: "2026-02-01T08:00:00.000Z",
          recordedBy: fixture.actorId,
          inRange: true,
          notes: null,
        });
        await tx.writeAudit({
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          action: "hms.monitoring_point.created",
          entityType: "monitoring_point",
          entityId: point.id,
          after: { rolled_back: false },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.monitoringPoints.size).toBe(baseline.monitoringPoints);
    expect(store.monitoringPoints.has(existing.id)).toBe(true);
    expect(store.monitoringReadings.size).toBe(baseline.monitoringReadings);
    expect(store.audits).toHaveLength(baseline.audits);
  });
});
