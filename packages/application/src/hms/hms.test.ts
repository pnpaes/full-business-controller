import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { findCorrectiveAction } from "./find-corrective-action";
import { findIncident } from "./find-incident";
import { findMonitoringPoint } from "./find-monitoring-point";
import { listCorrectiveActions } from "./list-corrective-actions";
import { listIncidents } from "./list-incidents";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import { recordCorrectiveAction } from "./record-corrective-action";
import type { RecordCorrectiveActionInput } from "./record-corrective-action";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerIncident } from "./register-incident";
import type { RegisterIncidentInput } from "./register-incident";
import { registerMonitoringPoint } from "./register-monitoring-point";
import type { RegisterMonitoringPointInput } from "./register-monitoring-point";
import { FakeHmsStore, seedHmsFixture, type HmsFixture } from "./test-support";
import type { CorrectiveActionRecord, IncidentRecord, MonitoringPointRecord } from "./types";
import { updateCorrectiveAction } from "./update-corrective-action";
import type { UpdateCorrectiveActionInput } from "./update-corrective-action";
import { updateIncident } from "./update-incident";
import type { UpdateIncidentInput } from "./update-incident";
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

function registerNearMiss(
  store: FakeHmsStore,
  fixture: HmsFixture,
  overrides: Partial<RegisterIncidentInput> = {},
): Promise<IncidentRecord> {
  return registerIncident(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    locationId: fixture.locationId,
    category: "near_miss",
    severity: "medium",
    occurredAt: "2026-02-01T10:00:00.000Z",
    reportedAt: "2026-02-01T10:05:00.000Z",
    reportedBy: fixture.actorId,
    title: "Pallets stacked too high",
    involvesPersonalData: false,
    ...overrides,
  });
}

function recordFix(
  store: FakeHmsStore,
  fixture: HmsFixture,
  overrides: Partial<RecordCorrectiveActionInput> = {},
): Promise<CorrectiveActionRecord> {
  return recordCorrectiveAction(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    description: "Re-stack the pallets lower",
    ...overrides,
  });
}

function updateFix(
  store: FakeHmsStore,
  fixture: HmsFixture,
  action: CorrectiveActionRecord,
  overrides: Partial<UpdateCorrectiveActionInput> = {},
): Promise<CorrectiveActionRecord> {
  return updateCorrectiveAction(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    correctiveActionId: action.id,
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

describe("registerIncident", () => {
  it("registers an incident as open with no close instant and writes its audit fact", async () => {
    const { store, fixture } = setup();

    const incident = await registerNearMiss(store, fixture, {
      title: "  Pallets stacked too high  ",
    });

    expect(incident).toMatchObject({
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      category: "near_miss",
      severity: "medium",
      occurredAt: "2026-02-01T10:00:00.000Z",
      reportedAt: "2026-02-01T10:05:00.000Z",
      reportedBy: fixture.actorId,
      ownerId: null,
      title: "Pallets stacked too high",
      description: null,
      dueDate: null,
      involvesPersonalData: false,
      status: "open",
      closedAt: null,
      createdBy: fixture.actorId,
    });
    expect(store.incidents.size).toBe(1);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      action: "hms.incident.created",
      entityType: "hms_incident",
      entityId: incident.id,
      after: {
        category: "near_miss",
        severity: "medium",
        status: "open",
        closed_at: null,
      },
    });
  });

  it("rejects an unknown category, severity, blank title, malformed instant or missing location", async () => {
    const { store, fixture } = setup();

    await expect(registerNearMiss(store, fixture, { category: "explosion" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerNearMiss(store, fixture, { severity: "catastrophic" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerNearMiss(store, fixture, { title: "   " })).rejects.toThrow(DomainError);
    await expect(registerNearMiss(store, fixture, { occurredAt: "2026-02-01" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerNearMiss(store, fixture, { locationId: "" })).rejects.toThrow(DomainError);

    expect(store.incidents.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a blank reportedBy and a malformed dueDate without writing", async () => {
    const { store, fixture } = setup();

    await expect(registerNearMiss(store, fixture, { reportedBy: "   " })).rejects.toThrow(
      DomainError,
    );
    await expect(registerNearMiss(store, fixture, { dueDate: "2026-02-31" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerNearMiss(store, fixture, { dueDate: "15/02/2026" })).rejects.toThrow(
      DomainError,
    );

    expect(store.incidents.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("updateIncident", () => {
  it("sets closed_at on the transition into closed and clears it on the move back out", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);

    const closed = await updateIncident(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      incidentId: incident.id,
      status: "closed",
    });

    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(closed.closedAt ?? ""))).toBe(false);
    expect(closed.updatedBy).toBe(fixture.actorId);

    const closeAudit = store.audits.find((audit) => audit.action === "hms.incident.closed");
    expect(closeAudit).toMatchObject({
      actorId: fixture.actorId,
      entityType: "hms_incident",
      entityId: incident.id,
      before: { status: "open" },
      after: { status: "closed" },
    });

    const reopened = await updateIncident(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      incidentId: incident.id,
      status: "investigating",
    });

    expect(reopened.status).toBe("investigating");
    expect(reopened.closedAt).toBeNull();
    // Only the close transition records the specific action; the reopen is generic.
    expect(store.audits.filter((audit) => audit.action === "hms.incident.closed")).toHaveLength(1);
    expect(store.audits.filter((audit) => audit.action === "hms.incident.updated")).toHaveLength(1);
  });

  it("preserves closed_at when an already-closed incident is closed again", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);

    const first = await updateIncident(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      incidentId: incident.id,
      status: "closed",
    });
    const second = await updateIncident(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      incidentId: incident.id,
      status: "closed",
    });

    expect(second.status).toBe("closed");
    // The re-close is idempotent: the original instant is not refreshed.
    expect(second.closedAt).toBe(first.closedAt);
    // Only the real transition fires the specific close action; the re-close is generic.
    expect(store.audits.filter((audit) => audit.action === "hms.incident.closed")).toHaveLength(1);
    expect(store.audits.filter((audit) => audit.action === "hms.incident.updated")).toHaveLength(1);
  });

  it("rejects an unknown status, severity or blank title and an empty patch without writing", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const update = (overrides: Partial<UpdateIncidentInput>) =>
      updateIncident(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        incidentId: incident.id,
        ...overrides,
      });

    await expect(update({ status: "pending" })).rejects.toThrow(DomainError);
    await expect(update({ severity: "catastrophic" })).rejects.toThrow(DomainError);
    await expect(update({ title: "  " })).rejects.toThrow(DomainError);
    await expect(update({})).rejects.toThrow(DomainError);

    expect(store.incidents.get(incident.id)).toMatchObject({
      status: "open",
      severity: "medium",
      title: "Pallets stacked too high",
      closedAt: null,
    });
    expect(store.audits.filter((audit) => audit.entityId === incident.id)).toHaveLength(1);
  });

  it("rejects a malformed dueDate without writing", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);

    await expect(
      updateIncident(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        incidentId: incident.id,
        dueDate: "2026-02-31",
      }),
    ).rejects.toThrow(DomainError);

    expect(store.incidents.get(incident.id)?.dueDate).toBeNull();
    expect(store.audits.filter((audit) => audit.action === "hms.incident.updated")).toHaveLength(0);
  });

  it("reports an unknown or cross-organization incident as NotFoundError", async () => {
    const { store, fixture } = setup();
    await registerNearMiss(store, fixture);
    const otherIncident = await registerNearMiss(store, {
      ...fixture,
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
    });

    await expect(
      updateIncident(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        incidentId: "missing",
        title: "Nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      updateIncident(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        incidentId: otherIncident.id,
        title: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.incidents.get(otherIncident.id)?.title).toBe("Pallets stacked too high");
    expect(store.audits.filter((audit) => audit.action === "hms.incident.updated")).toHaveLength(0);
  });
});

describe("recordCorrectiveAction", () => {
  it("records an action as open with no completion or verification fields and audits it", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);

    const action = await recordFix(store, fixture, {
      incidentId: incident.id,
      description: "  Re-stack the pallets lower  ",
      ownerId: fixture.ownerId,
      dueDate: "2026-02-15",
    });

    expect(action).toMatchObject({
      organizationId: fixture.organizationId,
      incidentId: incident.id,
      monitoringReadingId: null,
      description: "Re-stack the pallets lower",
      ownerId: fixture.ownerId,
      dueDate: "2026-02-15",
      status: "open",
      completedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      createdBy: fixture.actorId,
    });
    expect(store.correctiveActions.size).toBe(1);
    const audit = store.audits.find((row) => row.action === "hms.corrective_action.created");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "corrective_action",
      entityId: action.id,
      after: {
        incident_id: incident.id,
        status: "open",
        completed_at: null,
        verified_by: null,
        verified_at: null,
      },
    });
  });

  it("accepts a reading link or a standalone action, but still rejects a blank description", async () => {
    const { store, fixture } = setup();
    const point = await registerFridge(store, fixture);
    const reading = await recordMonitoringReading(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      monitoringPointId: point.id,
      value: "9",
      measuredAt: "2026-02-01T08:00:00.000Z",
    });

    const fromReading = await recordFix(store, fixture, {
      monitoringReadingId: reading.id,
      description: "Service the fridge door",
    });
    expect(fromReading).toMatchObject({
      incidentId: null,
      monitoringReadingId: reading.id,
      status: "open",
    });

    // Both links are optional (`DEC-090`), so a standalone improvement action
    // with neither link is a valid action.
    const standalone = await recordFix(store, fixture, {
      description: "Orphan action with no link",
    });
    expect(standalone).toMatchObject({
      incidentId: null,
      monitoringReadingId: null,
      status: "open",
    });

    await expect(
      recordFix(store, fixture, { incidentId: "incident-1", description: "   " }),
    ).rejects.toThrow(DomainError);

    expect(store.correctiveActions.size).toBe(2);
    expect(
      store.audits.filter((row) => row.action === "hms.corrective_action.created"),
    ).toHaveLength(2);
  });

  it("rejects a malformed dueDate without writing", async () => {
    const { store, fixture } = setup();

    await expect(recordFix(store, fixture, { dueDate: "2026-02-31" })).rejects.toThrow(DomainError);

    expect(store.correctiveActions.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("updateCorrectiveAction", () => {
  it("sets completed_at on done and the acting verifier on verified", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const action = await recordFix(store, fixture, { incidentId: incident.id });

    const done = await updateFix(store, fixture, action, { status: "done" });
    expect(done).toMatchObject({
      status: "done",
      verifiedBy: null,
      verifiedAt: null,
      updatedBy: fixture.actorId,
    });
    expect(done.completedAt).not.toBeNull();
    expect(
      store.audits.find(
        (row) => row.entityId === action.id && row.action === "hms.corrective_action.completed",
      )?.after,
    ).toEqual({ status: "done" });

    // The verifier is the acting actor, not the action's owner.
    const verified = await updateFix(store, { ...fixture, actorId: fixture.ownerId }, action, {
      status: "verified",
    });
    expect(verified.status).toBe("verified");
    // `completed_at` is preserved across the done → verified transition.
    expect(verified.completedAt).toBe(done.completedAt);
    expect(verified.verifiedBy).toBe(fixture.ownerId);
    expect(verified.verifiedAt).not.toBeNull();
    expect(
      store.audits.find(
        (row) => row.entityId === action.id && row.action === "hms.corrective_action.verified",
      ),
    ).toMatchObject({ actorId: fixture.ownerId, after: { status: "verified" } });
  });

  it("clears completion when leaving done/verified and the verifier when leaving verified", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const action = await recordFix(store, fixture, { incidentId: incident.id });
    await updateFix(store, fixture, action, { status: "verified" });

    // verified → done: still a completed action, but no longer a verified one.
    const done = await updateFix(store, fixture, action, { status: "done" });
    expect(done.completedAt).not.toBeNull();
    expect(done.verifiedBy).toBeNull();
    expect(done.verifiedAt).toBeNull();

    // done → in_progress: no completion and no verification.
    const reopened = await updateFix(store, fixture, action, { status: "in_progress" });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.verifiedBy).toBeNull();
    expect(reopened.verifiedAt).toBeNull();
  });

  it("preserves the original verifier when an already-verified action is verified again", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const action = await recordFix(store, fixture, { incidentId: incident.id });

    const first = await updateFix(store, fixture, action, { status: "verified" });
    // A second actor re-verifies the already-verified action.
    const second = await updateFix(store, { ...fixture, actorId: fixture.ownerId }, action, {
      status: "verified",
    });

    expect(second.status).toBe("verified");
    // The re-verify is idempotent: the original verifier and instant are not overwritten.
    expect(second.verifiedBy).toBe(first.verifiedBy);
    expect(second.verifiedAt).toBe(first.verifiedAt);
    expect(second.verifiedBy).toBe(fixture.actorId);
    // Only the real transition fires the specific verified action; the re-verify is generic.
    expect(
      store.audits.filter((row) => row.action === "hms.corrective_action.verified"),
    ).toHaveLength(1);
    expect(
      store.audits.filter((row) => row.action === "hms.corrective_action.updated"),
    ).toHaveLength(1);
  });

  it("rejects an unknown status and reports a scoped miss as NotFoundError", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const action = await recordFix(store, fixture, { incidentId: incident.id });
    const otherAction = await recordFix(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      incidentId: "incident-other",
    });

    await expect(updateFix(store, fixture, action, { status: "cancelled" })).rejects.toThrow(
      DomainError,
    );
    await expect(updateFix(store, fixture, otherAction, { status: "done" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      updateFix(store, fixture, { ...action, id: "missing" }, { status: "done" }),
    ).rejects.toThrow(NotFoundError);

    expect(store.correctiveActions.get(action.id)).toMatchObject({ status: "open" });
    expect(store.correctiveActions.get(otherAction.id)).toMatchObject({ status: "open" });
  });

  it("rejects a malformed dueDate without writing", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const action = await recordFix(store, fixture, { incidentId: incident.id });

    await expect(updateFix(store, fixture, action, { dueDate: "2026-02-31" })).rejects.toThrow(
      DomainError,
    );

    expect(store.correctiveActions.get(action.id)?.dueDate).toBeNull();
    expect(
      store.audits.filter((row) => row.action === "hms.corrective_action.updated"),
    ).toHaveLength(0);
  });
});

describe("findIncident and findCorrectiveAction", () => {
  it("return the row for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const otherIncident = await registerNearMiss(store, {
      ...fixture,
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
    });
    const action = await recordFix(store, fixture, { incidentId: incident.id });
    const otherAction = await recordFix(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      incidentId: otherIncident.id,
    });

    expect(
      (
        await findIncident(store, {
          organizationId: fixture.organizationId,
          incidentId: incident.id,
        })
      )?.id,
    ).toBe(incident.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findIncident(store, {
        organizationId: fixture.organizationId,
        incidentId: otherIncident.id,
      }),
    ).toBeUndefined();
    expect(
      await findIncident(store, { organizationId: fixture.organizationId, incidentId: "missing" }),
    ).toBeUndefined();

    expect(
      (
        await findCorrectiveAction(store, {
          organizationId: fixture.organizationId,
          correctiveActionId: action.id,
        })
      )?.id,
    ).toBe(action.id);
    expect(
      await findCorrectiveAction(store, {
        organizationId: fixture.organizationId,
        correctiveActionId: otherAction.id,
      }),
    ).toBeUndefined();
    expect(
      await findCorrectiveAction(store, {
        organizationId: fixture.organizationId,
        correctiveActionId: "missing",
      }),
    ).toBeUndefined();
  });
});

describe("listIncidents and listCorrectiveActions", () => {
  it("filters and pages the incident register, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const older = await registerNearMiss(store, fixture, {
      occurredAt: "2026-01-01T08:00:00.000Z",
    });
    const newer = await registerNearMiss(store, fixture, {
      occurredAt: "2026-03-01T08:00:00.000Z",
      category: "fire",
    });
    const elsewhere = await registerNearMiss(store, fixture, {
      occurredAt: "2026-02-01T08:00:00.000Z",
      locationId: "loc-kitchen",
    });
    const otherOrg = await registerNearMiss(
      store,
      {
        ...fixture,
        organizationId: fixture.otherOrganizationId,
        locationId: fixture.otherLocationId,
      },
      { occurredAt: "2026-04-01T08:00:00.000Z" },
    );
    await updateIncident(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      incidentId: older.id,
      status: "closed",
    });

    // Newest `occurred_at` first; the exact id list fails if the organization
    // filter were dropped (the other organization's row would be appended).
    expect(
      (await listIncidents(store, { organizationId: fixture.organizationId })).map((row) => row.id),
    ).toEqual([newer.id, elsewhere.id, older.id]);
    expect(
      (await listIncidents(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([otherOrg.id]);

    // Filters actually filter: status and location.
    expect(
      (await listIncidents(store, { organizationId: fixture.organizationId, status: "open" })).map(
        (row) => row.id,
      ),
    ).toEqual([newer.id, elsewhere.id]);
    expect(
      (
        await listIncidents(store, {
          organizationId: fixture.organizationId,
          locationId: fixture.locationId,
        })
      ).map((row) => row.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (
        await listIncidents(store, {
          organizationId: fixture.organizationId,
          locationId: "loc-kitchen",
        })
      ).map((row) => row.id),
    ).toEqual([elsewhere.id]);

    expect(
      (
        await listIncidents(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([elsewhere.id]);
  });

  it("filters and pages the corrective-action register, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const incident = await registerNearMiss(store, fixture);
    const dueLater = await recordFix(store, fixture, {
      incidentId: incident.id,
      description: "Later",
      dueDate: "2026-03-01",
      ownerId: fixture.ownerId,
    });
    const dueSooner = await recordFix(store, fixture, {
      incidentId: incident.id,
      description: "Sooner",
      dueDate: "2026-02-01",
      ownerId: fixture.ownerId,
    });
    const noDue = await recordFix(store, fixture, {
      incidentId: incident.id,
      description: "No due date",
    });
    await updateFix(store, fixture, dueSooner, { status: "done" });
    const otherIncident = await registerNearMiss(store, {
      ...fixture,
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
    });
    const otherOrgAction = await recordFix(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      incidentId: otherIncident.id,
      description: "Other tenant",
      dueDate: "2026-01-01",
    });

    // Earliest `due_date` first, a null due date last; the exact id list fails
    // if the organization filter were dropped.
    expect(
      (await listCorrectiveActions(store, { organizationId: fixture.organizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([dueSooner.id, dueLater.id, noDue.id]);
    expect(
      (await listCorrectiveActions(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([otherOrgAction.id]);

    expect(
      (
        await listCorrectiveActions(store, {
          organizationId: fixture.organizationId,
          incidentId: incident.id,
        })
      ).map((row) => row.id),
    ).toEqual([dueSooner.id, dueLater.id, noDue.id]);
    expect(
      (
        await listCorrectiveActions(store, {
          organizationId: fixture.organizationId,
          status: "open",
        })
      ).map((row) => row.id),
    ).toEqual([dueLater.id, noDue.id]);
    expect(
      (
        await listCorrectiveActions(store, {
          organizationId: fixture.organizationId,
          ownerId: fixture.ownerId,
        })
      ).map((row) => row.id),
    ).toEqual([dueSooner.id, dueLater.id]);

    expect(
      (
        await listCorrectiveActions(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([dueLater.id]);
  });
});
