import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { findChecklistRun } from "./find-checklist-run";
import { findChecklistTemplate } from "./find-checklist-template";
import { findCorrectiveAction } from "./find-corrective-action";
import { findEquipment } from "./find-equipment";
import { findIncident } from "./find-incident";
import { findMaintenanceLog } from "./find-maintenance-log";
import { findMonitoringPoint } from "./find-monitoring-point";
import { listChecklistRuns } from "./list-checklist-runs";
import { listChecklistTemplates } from "./list-checklist-templates";
import { listCorrectiveActions } from "./list-corrective-actions";
import { listEquipment } from "./list-equipment";
import { listIncidents } from "./list-incidents";
import { listMaintenanceLogs } from "./list-maintenance-logs";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import { recordChecklistRun } from "./record-checklist-run";
import type { RecordChecklistRunInput } from "./record-checklist-run";
import { recordCorrectiveAction } from "./record-corrective-action";
import type { RecordCorrectiveActionInput } from "./record-corrective-action";
import { recordMaintenanceLog } from "./record-maintenance-log";
import type { RecordMaintenanceLogInput } from "./record-maintenance-log";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerChecklistTemplate } from "./register-checklist-template";
import type { RegisterChecklistTemplateInput } from "./register-checklist-template";
import { registerEquipment } from "./register-equipment";
import type { RegisterEquipmentInput } from "./register-equipment";
import { registerIncident } from "./register-incident";
import type { RegisterIncidentInput } from "./register-incident";
import { registerMonitoringPoint } from "./register-monitoring-point";
import type { RegisterMonitoringPointInput } from "./register-monitoring-point";
import { FakeHmsStore, seedHmsFixture, type HmsFixture } from "./test-support";
import type {
  ChecklistRunRecord,
  ChecklistTemplateRecord,
  CorrectiveActionRecord,
  EquipmentRecord,
  IncidentRecord,
  MaintenanceLogRecord,
  MonitoringPointRecord,
} from "./types";
import { updateChecklistRun } from "./update-checklist-run";
import type { UpdateChecklistRunInput } from "./update-checklist-run";
import { updateChecklistTemplate } from "./update-checklist-template";
import type { UpdateChecklistTemplateInput } from "./update-checklist-template";
import { updateCorrectiveAction } from "./update-corrective-action";
import type { UpdateCorrectiveActionInput } from "./update-corrective-action";
import { updateEquipment } from "./update-equipment";
import type { UpdateEquipmentInput } from "./update-equipment";
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

const CLEANING_ITEMS = [
  { key: "floor", label: "Mop the floor" },
  { key: "bins", label: "Empty the bins", required: false },
];

function registerCleaningTemplate(
  store: FakeHmsStore,
  fixture: HmsFixture,
  overrides: Partial<RegisterChecklistTemplateInput> = {},
): Promise<ChecklistTemplateRecord> {
  return registerChecklistTemplate(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    name: "Daily cleaning",
    category: "cleaning",
    frequency: "daily",
    items: CLEANING_ITEMS,
    ...overrides,
  });
}

function updateCleaningTemplate(
  store: FakeHmsStore,
  fixture: HmsFixture,
  template: ChecklistTemplateRecord,
  overrides: Partial<UpdateChecklistTemplateInput> = {},
): Promise<ChecklistTemplateRecord> {
  return updateChecklistTemplate(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    templateId: template.id,
    ...overrides,
  });
}

function recordRun(
  store: FakeHmsStore,
  fixture: HmsFixture,
  template: ChecklistTemplateRecord,
  overrides: Partial<RecordChecklistRunInput> = {},
): Promise<ChecklistRunRecord> {
  return recordChecklistRun(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    templateId: template.id,
    locationId: fixture.locationId,
    runAt: "2026-02-01T08:00:00.000Z",
    performedBy: fixture.actorId,
    results: [{ key: "floor", outcome: "pass" }],
    ...overrides,
  });
}

function updateRun(
  store: FakeHmsStore,
  fixture: HmsFixture,
  run: ChecklistRunRecord,
  overrides: Partial<UpdateChecklistRunInput> = {},
): Promise<ChecklistRunRecord> {
  return updateChecklistRun(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    runId: run.id,
    ...overrides,
  });
}

function registerIceMachine(
  store: FakeHmsStore,
  fixture: HmsFixture,
  overrides: Partial<RegisterEquipmentInput> = {},
): Promise<EquipmentRecord> {
  return registerEquipment(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    locationId: fixture.locationId,
    code: "eq-ice",
    name: "Ice machine",
    kind: "refrigeration",
    ...overrides,
  });
}

function updateIceMachine(
  store: FakeHmsStore,
  fixture: HmsFixture,
  equipment: EquipmentRecord,
  overrides: Partial<UpdateEquipmentInput> = {},
): Promise<EquipmentRecord> {
  return updateEquipment(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    equipmentId: equipment.id,
    ...overrides,
  });
}

function recordService(
  store: FakeHmsStore,
  fixture: HmsFixture,
  equipment: EquipmentRecord,
  overrides: Partial<RecordMaintenanceLogInput> = {},
): Promise<MaintenanceLogRecord> {
  return recordMaintenanceLog(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    equipmentId: equipment.id,
    kind: "service",
    performedAt: "2026-02-01T09:00:00.000Z",
    performedBy: fixture.actorId,
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

  it("rolls back checklist template and run writes when the callback throws", async () => {
    const { store, fixture } = setup();
    const existing = await registerCleaningTemplate(store, fixture);

    const baseline = {
      checklistTemplates: store.checklistTemplates.size,
      checklistRuns: store.checklistRuns.size,
      audits: store.audits.length,
    };

    await expect(
      store.withTransaction(async (tx) => {
        const template = await tx.createChecklistTemplate({
          organizationId: fixture.organizationId,
          name: "Rolled-back template",
          category: "cleaning",
          frequency: "daily",
          items: [],
          active: true,
          supersedesId: null,
          createdBy: fixture.actorId,
        });
        await tx.createChecklistRun({
          organizationId: fixture.organizationId,
          templateId: template.id,
          locationId: fixture.locationId,
          runAt: "2026-02-01T08:00:00.000Z",
          performedBy: fixture.actorId,
          status: "in_progress",
          results: [],
          notes: null,
          createdBy: fixture.actorId,
        });
        await tx.writeAudit({
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          action: "hms.checklist_template.created",
          entityType: "checklist_template",
          entityId: template.id,
          after: { rolled_back: false },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.checklistTemplates.size).toBe(baseline.checklistTemplates);
    expect(store.checklistTemplates.has(existing.id)).toBe(true);
    expect(store.checklistRuns.size).toBe(baseline.checklistRuns);
    expect(store.audits).toHaveLength(baseline.audits);
  });

  it("rolls back equipment and maintenance-log writes when the callback throws", async () => {
    const { store, fixture } = setup();
    const existing = await registerIceMachine(store, fixture);

    const baseline = {
      equipment: store.equipment.size,
      maintenanceLogs: store.maintenanceLogs.size,
      audits: store.audits.length,
    };

    await expect(
      store.withTransaction(async (tx) => {
        const created = await tx.createEquipment({
          organizationId: fixture.organizationId,
          locationId: fixture.locationId,
          code: "eq-rolled-back",
          name: "Rolled-back machine",
          kind: "refrigeration",
          serialNo: null,
          installedAt: null,
          warrantyUntil: null,
          active: true,
          createdBy: fixture.actorId,
        });
        await tx.createMaintenanceLog({
          organizationId: fixture.organizationId,
          equipmentId: created.id,
          kind: "service",
          performedAt: "2026-02-01T09:00:00.000Z",
          performedBy: fixture.actorId,
          notes: null,
          fileObjectId: null,
          createdBy: fixture.actorId,
        });
        await tx.writeAudit({
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          action: "hms.equipment.created",
          entityType: "equipment",
          entityId: created.id,
          after: { rolled_back: false },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.equipment.size).toBe(baseline.equipment);
    expect(store.equipment.has(existing.id)).toBe(true);
    expect(store.maintenanceLogs.size).toBe(baseline.maintenanceLogs);
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

describe("registerChecklistTemplate", () => {
  it("registers an active template, trims the name and writes its audit fact", async () => {
    const { store, fixture } = setup();

    const template = await registerCleaningTemplate(store, fixture, {
      name: "  Daily cleaning  ",
    });

    expect(template).toMatchObject({
      organizationId: fixture.organizationId,
      name: "Daily cleaning",
      category: "cleaning",
      frequency: "daily",
      items: CLEANING_ITEMS,
      active: true,
      supersedesId: null,
      createdBy: fixture.actorId,
    });
    expect(store.checklistTemplates.size).toBe(1);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      action: "hms.checklist_template.created",
      entityType: "checklist_template",
      entityId: template.id,
      after: {
        name: "Daily cleaning",
        category: "cleaning",
        frequency: "daily",
        active: true,
        supersedes_id: null,
      },
    });
  });

  it("records a revision, deactivates the superseded row and audits both", async () => {
    const { store, fixture } = setup();
    const first = await registerCleaningTemplate(store, fixture, { name: "Daily cleaning (v1)" });

    const revision = await registerCleaningTemplate(store, fixture, {
      name: "Daily cleaning (v2)",
      supersedesId: first.id,
    });

    // The revision is active and points at the row it replaces; the replaced
    // row is retired in the same transaction (`DEC-096`).
    expect(revision).toMatchObject({ active: true, supersedesId: first.id });
    expect(store.checklistTemplates.get(first.id)?.active).toBe(false);

    // v1 created, v1 deactivated, v2 created — three facts.
    expect(store.audits).toHaveLength(3);
    expect(store.audits[1]).toMatchObject({
      action: "hms.checklist_template.updated",
      entityType: "checklist_template",
      entityId: first.id,
      before: { active: true },
      after: { active: false },
    });
    expect(store.audits[2]).toMatchObject({
      action: "hms.checklist_template.created",
      entityType: "checklist_template",
      entityId: revision.id,
      after: { name: "Daily cleaning (v2)", active: true, supersedes_id: first.id },
    });
  });

  it("rejects superseding a deactivated template or an unknown one without writing", async () => {
    const { store, fixture } = setup();
    const retired = await registerCleaningTemplate(store, fixture, { active: false });

    await expect(
      registerCleaningTemplate(store, fixture, { name: "Revival", supersedesId: retired.id }),
    ).rejects.toThrow(DomainError);
    await expect(
      registerCleaningTemplate(store, fixture, { name: "Revival", supersedesId: "missing" }),
    ).rejects.toThrow(NotFoundError);

    expect(store.checklistTemplates.size).toBe(1);
    expect(store.checklistTemplates.get(retired.id)?.active).toBe(false);
    // Only the retired template's own create fact exists; no revision was made.
    expect(store.audits).toHaveLength(1);
  });

  it("rejects an unknown category or frequency and a blank name without writing", async () => {
    const { store, fixture } = setup();

    await expect(
      registerCleaningTemplate(store, fixture, { category: "deep_clean" }),
    ).rejects.toThrow(DomainError);
    await expect(registerCleaningTemplate(store, fixture, { frequency: "hourly" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerCleaningTemplate(store, fixture, { name: "   " })).rejects.toThrow(
      DomainError,
    );

    expect(store.checklistTemplates.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a malformed items array naming the offending index and field", async () => {
    const { store, fixture } = setup();

    await expect(
      registerCleaningTemplate(store, fixture, { items: { key: "floor" } }),
    ).rejects.toThrow(/items must be a JSON array/);
    await expect(
      registerCleaningTemplate(store, fixture, { items: [{ label: "Mop" }] }),
    ).rejects.toThrow(/items\[0\]\.key is required/);
    await expect(
      registerCleaningTemplate(store, fixture, { items: [{ key: "floor" }] }),
    ).rejects.toThrow(/items\[0\]\.label is required/);
    await expect(
      registerCleaningTemplate(store, fixture, {
        items: [{ key: "floor", label: "Mop", required: "yes" }],
      }),
    ).rejects.toThrow(/items\[0\]\.required must be a boolean/);

    // Extra keys pass through untouched (`DEC-096`).
    const template = await registerCleaningTemplate(store, fixture, {
      items: [{ key: "floor", label: "Mop", zone: "kitchen" }],
    });
    expect(template.items).toEqual([{ key: "floor", label: "Mop", zone: "kitchen" }]);

    expect(store.checklistTemplates.size).toBe(1);
    expect(store.audits).toHaveLength(1);
  });

  it("caps the items array at the shared ceiling", async () => {
    const { store, fixture } = setup();
    const overCeiling = Array.from({ length: 501 }, (_, index) => ({
      key: `item-${index}`,
      label: `Item ${index}`,
    }));

    await expect(registerCleaningTemplate(store, fixture, { items: overCeiling })).rejects.toThrow(
      /items must hold at most 500 elements/,
    );
    expect(store.checklistTemplates.size).toBe(0);

    // Exactly at the ceiling is allowed.
    const atCeiling = overCeiling.slice(0, 500);
    const template = await registerCleaningTemplate(store, fixture, { items: atCeiling });
    expect(template.items).toEqual(atCeiling);
  });
});

describe("updateChecklistTemplate", () => {
  it("patches fields and audits before/after in snake_case", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    const updated = await updateCleaningTemplate(store, fixture, template, {
      name: "Daily cleaning (front)",
      category: "hygiene",
      frequency: "weekly",
      items: [{ key: "floor", label: "Mop the floor" }],
      active: false,
    });

    expect(updated).toMatchObject({
      id: template.id,
      name: "Daily cleaning (front)",
      category: "hygiene",
      frequency: "weekly",
      active: false,
      updatedBy: fixture.actorId,
    });
    expect(updated.items).toEqual([{ key: "floor", label: "Mop the floor" }]);

    const audit = store.audits.find((row) => row.action === "hms.checklist_template.updated");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "checklist_template",
      entityId: template.id,
      before: {
        name: "Daily cleaning",
        category: "cleaning",
        frequency: "daily",
        items: CLEANING_ITEMS,
        active: true,
      },
      after: {
        name: "Daily cleaning (front)",
        category: "hygiene",
        frequency: "weekly",
        items: [{ key: "floor", label: "Mop the floor" }],
        active: false,
      },
    });
  });

  it("rejects unknown vocabularies, a malformed items array and an empty patch without writing", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    await expect(updateCleaningTemplate(store, fixture, template, {})).rejects.toThrow(DomainError);
    await expect(
      updateCleaningTemplate(store, fixture, template, { category: "deep_clean" }),
    ).rejects.toThrow(DomainError);
    await expect(
      updateCleaningTemplate(store, fixture, template, { frequency: "hourly" }),
    ).rejects.toThrow(DomainError);
    await expect(updateCleaningTemplate(store, fixture, template, { name: "  " })).rejects.toThrow(
      DomainError,
    );
    await expect(
      updateCleaningTemplate(store, fixture, template, { items: "nope" }),
    ).rejects.toThrow(/items must be a JSON array/);

    expect(store.checklistTemplates.get(template.id)).toMatchObject({
      name: "Daily cleaning",
      category: "cleaning",
      frequency: "daily",
      active: true,
    });
    expect(
      store.audits.filter((row) => row.action === "hms.checklist_template.updated"),
    ).toHaveLength(0);
  });

  it("reports an unknown or cross-organization template as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Other tenant",
    });

    await expect(
      updateChecklistTemplate(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        templateId: "missing",
        name: "Nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      updateChecklistTemplate(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        templateId: other.id,
        name: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.checklistTemplates.get(other.id)?.name).toBe("Other tenant");
  });
});

describe("recordChecklistRun", () => {
  it("records a run as in_progress by default with its results and audit fact", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const results = [
      { key: "floor", outcome: "pass" },
      { key: "bins", outcome: "fail", note: "overflowing" },
    ];

    const run = await recordRun(store, fixture, template, { results });

    expect(run).toMatchObject({
      organizationId: fixture.organizationId,
      templateId: template.id,
      locationId: fixture.locationId,
      runAt: "2026-02-01T08:00:00.000Z",
      performedBy: fixture.actorId,
      status: "in_progress",
      notes: null,
      createdBy: fixture.actorId,
    });
    expect(run.results).toEqual(results);

    const audit = store.audits.find((row) => row.action === "hms.checklist_run.recorded");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "checklist_run",
      entityId: run.id,
      after: {
        template_id: template.id,
        location_id: fixture.locationId,
        run_at: "2026-02-01T08:00:00.000Z",
        status: "in_progress",
      },
    });
  });

  it("accepts an explicit completed status and notes", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    const run = await recordRun(store, fixture, template, {
      status: "completed",
      notes: "everything done",
    });

    expect(run).toMatchObject({ status: "completed", notes: "everything done" });
  });

  it("rejects a bad status, missing ids/operator, malformed instant or malformed results without writing", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    await expect(recordRun(store, fixture, template, { status: "pending" })).rejects.toThrow(
      DomainError,
    );
    await expect(recordRun(store, fixture, template, { templateId: "" })).rejects.toThrow(
      DomainError,
    );
    await expect(recordRun(store, fixture, template, { locationId: "  " })).rejects.toThrow(
      DomainError,
    );
    await expect(recordRun(store, fixture, template, { performedBy: "" })).rejects.toThrow(
      DomainError,
    );
    await expect(recordRun(store, fixture, template, { runAt: "2026-02-01" })).rejects.toThrow(
      DomainError,
    );
    await expect(recordRun(store, fixture, template, { results: {} })).rejects.toThrow(
      /results must be a JSON array/,
    );
    await expect(
      recordRun(store, fixture, template, { results: [{ key: "floor" }] }),
    ).rejects.toThrow(/results\[0\]\.outcome must be one of/);
    await expect(
      recordRun(store, fixture, template, { results: [{ key: "floor", outcome: "maybe" }] }),
    ).rejects.toThrow(/results\[0\]\.outcome must be one of/);
    await expect(
      recordRun(store, fixture, template, { results: [{ outcome: "pass" }] }),
    ).rejects.toThrow(/results\[0\]\.key is required/);
    await expect(
      recordRun(store, fixture, template, {
        results: [{ key: "floor", outcome: "pass", note: 5 }],
      }),
    ).rejects.toThrow(/results\[0\]\.note must be a string/);

    expect(store.checklistRuns.size).toBe(0);
    expect(store.audits.filter((row) => row.action === "hms.checklist_run.recorded")).toHaveLength(
      0,
    );
  });

  it("rejects a result key the template does not define", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    await expect(
      recordRun(store, fixture, template, { results: [{ key: "windows", outcome: "pass" }] }),
    ).rejects.toThrow(/results\[0\]\.key "windows" is not an item of the template/);

    expect(store.checklistRuns.size).toBe(0);
    expect(store.audits.filter((row) => row.action === "hms.checklist_run.recorded")).toHaveLength(
      0,
    );
  });

  it("caps the results array at the shared ceiling", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const results = Array.from({ length: 501 }, () => ({ key: "floor", outcome: "pass" }));

    await expect(recordRun(store, fixture, template, { results })).rejects.toThrow(
      /results must hold at most 500 elements/,
    );
    expect(store.checklistRuns.size).toBe(0);
  });

  it("reports an unknown or cross-organization template as NotFoundError", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);

    await expect(recordRun(store, fixture, template, { templateId: "missing" })).rejects.toThrow(
      NotFoundError,
    );

    const otherTemplate = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Other tenant template",
    });
    await expect(recordRun(store, fixture, otherTemplate)).rejects.toThrow(NotFoundError);

    expect(store.checklistRuns.size).toBe(0);
  });
});

describe("updateChecklistRun", () => {
  it("patches status, results and notes and audits before/after", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const run = await recordRun(store, fixture, template);

    const updated = await updateRun(store, fixture, run, {
      status: "completed",
      results: [{ key: "floor", outcome: "fail", note: "spilled" }],
      notes: "spilled during prep",
    });

    expect(updated).toMatchObject({
      status: "completed",
      notes: "spilled during prep",
      updatedBy: fixture.actorId,
    });
    expect(updated.results).toEqual([{ key: "floor", outcome: "fail", note: "spilled" }]);

    // `status` carries no derived companion (`DEC-096`): only the vocabulary
    // value moves, unlike the incident close or corrective-action verification.
    const audit = store.audits.find((row) => row.action === "hms.checklist_run.updated");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "checklist_run",
      entityId: run.id,
      before: { status: "in_progress", results: [{ key: "floor", outcome: "pass" }], notes: null },
      after: {
        status: "completed",
        results: [{ key: "floor", outcome: "fail", note: "spilled" }],
        notes: "spilled during prep",
      },
    });
  });

  it("clears notes with an explicit null", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const run = await recordRun(store, fixture, template, { notes: "draft notes" });

    const updated = await updateRun(store, fixture, run, { notes: null });

    expect(updated.notes).toBeNull();
  });

  it("rejects an empty patch, an unknown status and malformed results without writing", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const run = await recordRun(store, fixture, template);

    await expect(updateRun(store, fixture, run, {})).rejects.toThrow(DomainError);
    await expect(updateRun(store, fixture, run, { status: "pending" })).rejects.toThrow(
      DomainError,
    );
    await expect(updateRun(store, fixture, run, { results: "nope" })).rejects.toThrow(
      /results must be a JSON array/,
    );
    await expect(
      updateRun(store, fixture, run, { results: [{ key: "floor", outcome: "maybe" }] }),
    ).rejects.toThrow(/results\[0\]\.outcome must be one of/);

    expect(store.checklistRuns.get(run.id)).toMatchObject({
      status: "in_progress",
      notes: null,
    });
    expect(store.audits.filter((row) => row.action === "hms.checklist_run.updated")).toHaveLength(
      0,
    );
  });

  it("rejects a result key the run's template does not define", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const run = await recordRun(store, fixture, template);

    await expect(
      updateRun(store, fixture, run, { results: [{ key: "windows", outcome: "pass" }] }),
    ).rejects.toThrow(/results\[0\]\.key "windows" is not an item of the template/);

    expect(store.checklistRuns.get(run.id)?.results).toEqual([{ key: "floor", outcome: "pass" }]);
    expect(store.audits.filter((row) => row.action === "hms.checklist_run.updated")).toHaveLength(
      0,
    );
  });

  it("reports an unknown or cross-organization run as NotFoundError", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const run = await recordRun(store, fixture, template);
    const otherTemplate = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Other tenant template",
    });
    const otherRun = await recordRun(store, fixture, otherTemplate, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
    });

    await expect(
      updateChecklistRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        runId: "missing",
        status: "completed",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      updateChecklistRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        runId: otherRun.id,
        status: "completed",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.checklistRuns.get(run.id)?.status).toBe("in_progress");
    expect(store.checklistRuns.get(otherRun.id)?.status).toBe("in_progress");
  });
});

describe("findChecklistTemplate and findChecklistRun", () => {
  it("return the row for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const otherTemplate = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Other tenant template",
    });
    const run = await recordRun(store, fixture, template);
    const otherRun = await recordRun(store, fixture, otherTemplate, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
    });

    expect(
      (
        await findChecklistTemplate(store, {
          organizationId: fixture.organizationId,
          templateId: template.id,
        })
      )?.id,
    ).toBe(template.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findChecklistTemplate(store, {
        organizationId: fixture.organizationId,
        templateId: otherTemplate.id,
      }),
    ).toBeUndefined();
    expect(
      await findChecklistTemplate(store, {
        organizationId: fixture.organizationId,
        templateId: "missing",
      }),
    ).toBeUndefined();

    expect(
      (
        await findChecklistRun(store, {
          organizationId: fixture.organizationId,
          runId: run.id,
        })
      )?.id,
    ).toBe(run.id);
    expect(
      await findChecklistRun(store, {
        organizationId: fixture.organizationId,
        runId: otherRun.id,
      }),
    ).toBeUndefined();
    expect(
      await findChecklistRun(store, { organizationId: fixture.organizationId, runId: "missing" }),
    ).toBeUndefined();
  });
});

describe("listChecklistTemplates and listChecklistRuns", () => {
  it("lists templates by name with filters and paging, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const beta = await registerCleaningTemplate(store, fixture, {
      name: "Beta routine",
      category: "hygiene",
    });
    const alpha = await registerCleaningTemplate(store, fixture, { name: "Alpha routine" });
    const retired = await registerCleaningTemplate(store, fixture, {
      name: "Gamma routine",
      active: false,
    });
    const otherOrg = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Alpha routine",
    });

    // Name ascending; the exact id list fails if the organization filter were
    // dropped (the other organization's row would be appended).
    expect(
      (await listChecklistTemplates(store, { organizationId: fixture.organizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([alpha.id, beta.id, retired.id]);
    expect(
      (await listChecklistTemplates(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([otherOrg.id]);

    expect(
      (
        await listChecklistTemplates(store, {
          organizationId: fixture.organizationId,
          category: "cleaning",
        })
      ).map((row) => row.id),
    ).toEqual([alpha.id, retired.id]);
    expect(
      (
        await listChecklistTemplates(store, {
          organizationId: fixture.organizationId,
          active: true,
        })
      ).map((row) => row.id),
    ).toEqual([alpha.id, beta.id]);
    expect(
      (
        await listChecklistTemplates(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([beta.id]);
  });

  it("lists runs newest first with filters and paging, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const template = await registerCleaningTemplate(store, fixture);
    const secondTemplate = await registerCleaningTemplate(store, fixture, {
      name: "Closing routine",
      category: "closing",
    });
    const older = await recordRun(store, fixture, template, {
      runAt: "2026-01-01T08:00:00.000Z",
    });
    const newer = await recordRun(store, fixture, template, {
      runAt: "2026-03-01T08:00:00.000Z",
      status: "completed",
    });
    const kitchen = await recordRun(store, fixture, secondTemplate, {
      runAt: "2026-02-01T08:00:00.000Z",
      locationId: "loc-kitchen",
    });
    const otherTemplate = await registerCleaningTemplate(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      name: "Other tenant routine",
    });
    const otherOrg = await recordRun(store, fixture, otherTemplate, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      runAt: "2026-04-01T08:00:00.000Z",
    });

    // Newest `run_at` first; the exact id list fails if the organization filter
    // were dropped (the other organization's newer row would be first).
    expect(
      (await listChecklistRuns(store, { organizationId: fixture.organizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([newer.id, kitchen.id, older.id]);
    expect(
      (await listChecklistRuns(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([otherOrg.id]);

    expect(
      (
        await listChecklistRuns(store, {
          organizationId: fixture.organizationId,
          templateId: template.id,
        })
      ).map((row) => row.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (
        await listChecklistRuns(store, {
          organizationId: fixture.organizationId,
          locationId: fixture.locationId,
        })
      ).map((row) => row.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (
        await listChecklistRuns(store, {
          organizationId: fixture.organizationId,
          status: "completed",
        })
      ).map((row) => row.id),
    ).toEqual([newer.id]);
    expect(
      (
        await listChecklistRuns(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([kitchen.id]);
  });
});

describe("registerEquipment", () => {
  it("registers active equipment, trims text and writes its audit fact", async () => {
    const { store, fixture } = setup();

    const equipment = await registerIceMachine(store, fixture, {
      code: "  eq-ice  ",
      name: "  Ice machine  ",
      kind: "  refrigeration  ",
      serialNo: "SN-123",
      installedAt: "2025-05-01",
      warrantyUntil: "2027-05-01",
    });

    expect(equipment).toMatchObject({
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      code: "eq-ice",
      name: "Ice machine",
      kind: "refrigeration",
      serialNo: "SN-123",
      installedAt: "2025-05-01",
      warrantyUntil: "2027-05-01",
      active: true,
      createdBy: fixture.actorId,
    });
    expect(store.equipment.size).toBe(1);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      action: "hms.equipment.created",
      entityType: "equipment",
      entityId: equipment.id,
      after: {
        location_id: fixture.locationId,
        code: "eq-ice",
        name: "Ice machine",
        kind: "refrigeration",
        serial_no: "SN-123",
        installed_at: "2025-05-01",
        warranty_until: "2027-05-01",
        active: true,
      },
    });
  });

  it("defaults active to true but honours an explicit false and a cleared serial", async () => {
    const { store, fixture } = setup();

    const active = await registerIceMachine(store, fixture);
    expect(active.active).toBe(true);
    expect(active.serialNo).toBeNull();
    expect(active.installedAt).toBeNull();
    expect(active.warrantyUntil).toBeNull();

    const retired = await registerIceMachine(store, fixture, { code: "eq-old", active: false });
    expect(retired.active).toBe(false);
  });

  it("rejects blank code, name or kind, a missing location and a malformed date without writing", async () => {
    const { store, fixture } = setup();

    await expect(registerIceMachine(store, fixture, { code: "   " })).rejects.toThrow(DomainError);
    await expect(registerIceMachine(store, fixture, { name: "  " })).rejects.toThrow(DomainError);
    await expect(registerIceMachine(store, fixture, { kind: "  " })).rejects.toThrow(DomainError);
    await expect(registerIceMachine(store, fixture, { locationId: "" })).rejects.toThrow(
      DomainError,
    );
    await expect(registerIceMachine(store, fixture, { installedAt: "2026-02-31" })).rejects.toThrow(
      /installedAt must be a date/,
    );
    await expect(registerIceMachine(store, fixture, { warrantyUntil: "nope" })).rejects.toThrow(
      /warrantyUntil must be a date/,
    );

    expect(store.equipment.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects text over the field ceilings, accepting the boundary", async () => {
    const { store, fixture } = setup();

    // The ceiling itself is accepted (the check is `> max`, not `>= max`).
    const atBoundary = await registerIceMachine(store, fixture, { code: "c".repeat(64) });
    expect(atBoundary.code).toBe("c".repeat(64));

    await expect(registerIceMachine(store, fixture, { code: "c".repeat(65) })).rejects.toThrow(
      /code must be at most 64 characters/,
    );
    await expect(registerIceMachine(store, fixture, { name: "n".repeat(201) })).rejects.toThrow(
      /name must be at most 200 characters/,
    );
    await expect(registerIceMachine(store, fixture, { kind: "k".repeat(33) })).rejects.toThrow(
      /kind must be at most 32 characters/,
    );
    await expect(registerIceMachine(store, fixture, { serialNo: "s".repeat(201) })).rejects.toThrow(
      /serialNo must be at most 200 characters/,
    );

    // Only the accepted boundary row was written.
    expect(store.equipment.size).toBe(1);
    expect(store.audits).toHaveLength(1);
  });
});

describe("updateEquipment", () => {
  it("patches fields and audits before/after in snake_case", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture, {
      serialNo: "SN-123",
      installedAt: "2025-05-01",
    });

    const updated = await updateIceMachine(store, fixture, equipment, {
      name: "Ice machine (bar)",
      kind: "ice",
      serialNo: "SN-999",
      installedAt: "2025-06-01",
      warrantyUntil: "2028-06-01",
      active: false,
    });

    expect(updated).toMatchObject({
      id: equipment.id,
      code: "eq-ice",
      name: "Ice machine (bar)",
      kind: "ice",
      serialNo: "SN-999",
      installedAt: "2025-06-01",
      warrantyUntil: "2028-06-01",
      active: false,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });

    const audit = store.audits.find((row) => row.action === "hms.equipment.updated");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "equipment",
      entityId: equipment.id,
      before: {
        name: "Ice machine",
        kind: "refrigeration",
        serial_no: "SN-123",
        installed_at: "2025-05-01",
        warranty_until: null,
        active: true,
      },
      after: {
        name: "Ice machine (bar)",
        kind: "ice",
        serial_no: "SN-999",
        installed_at: "2025-06-01",
        warranty_until: "2028-06-01",
        active: false,
      },
    });
  });

  it("clears an optional field with an explicit null", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture, { serialNo: "SN-123" });

    const updated = await updateIceMachine(store, fixture, equipment, { serialNo: null });
    expect(updated.serialNo).toBeNull();

    const audit = store.audits.find((row) => row.action === "hms.equipment.updated");
    expect(audit).toMatchObject({ before: { serial_no: "SN-123" }, after: { serial_no: null } });
  });

  it("rejects an empty patch, blank text and a malformed date without writing", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    await expect(updateIceMachine(store, fixture, equipment, {})).rejects.toThrow(DomainError);
    await expect(updateIceMachine(store, fixture, equipment, { name: "  " })).rejects.toThrow(
      DomainError,
    );
    await expect(updateIceMachine(store, fixture, equipment, { kind: "  " })).rejects.toThrow(
      DomainError,
    );
    await expect(
      updateIceMachine(store, fixture, equipment, { installedAt: "2026-02-31" }),
    ).rejects.toThrow(/installedAt must be a date/);
    await expect(
      updateIceMachine(store, fixture, equipment, { warrantyUntil: "nope" }),
    ).rejects.toThrow(/warrantyUntil must be a date/);

    expect(store.equipment.get(equipment.id)).toMatchObject({
      name: "Ice machine",
      kind: "refrigeration",
      active: true,
    });
    expect(store.audits.filter((row) => row.action === "hms.equipment.updated")).toHaveLength(0);
  });

  it("rejects patched text over the field ceilings without writing", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    await expect(
      updateIceMachine(store, fixture, equipment, { name: "n".repeat(201) }),
    ).rejects.toThrow(/name must be at most 200 characters/);
    await expect(
      updateIceMachine(store, fixture, equipment, { kind: "k".repeat(33) }),
    ).rejects.toThrow(/kind must be at most 32 characters/);
    await expect(
      updateIceMachine(store, fixture, equipment, { serialNo: "s".repeat(201) }),
    ).rejects.toThrow(/serialNo must be at most 200 characters/);

    expect(store.equipment.get(equipment.id)).toMatchObject({
      name: "Ice machine",
      kind: "refrigeration",
      serialNo: null,
    });
    expect(store.audits.filter((row) => row.action === "hms.equipment.updated")).toHaveLength(0);
  });

  it("reports an unknown or cross-organization row as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await registerIceMachine(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      code: "eq-other",
    });

    await expect(
      updateEquipment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        equipmentId: "missing",
        name: "Nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);
    // The org filter is load-bearing: dropping it would edit the other row.
    await expect(
      updateEquipment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        equipmentId: other.id,
        name: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.equipment.get(other.id)?.name).toBe("Ice machine");
  });
});

describe("recordMaintenanceLog", () => {
  it("records a maintenance fact with its operator and audit fact", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    const log = await recordService(store, fixture, equipment, { notes: "replaced the filter" });

    expect(log).toMatchObject({
      organizationId: fixture.organizationId,
      equipmentId: equipment.id,
      kind: "service",
      performedAt: "2026-02-01T09:00:00.000Z",
      performedBy: fixture.actorId,
      notes: "replaced the filter",
      fileObjectId: null,
      createdBy: fixture.actorId,
    });
    expect(store.maintenanceLogs.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "hms.maintenance_log.recorded");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "maintenance_log",
      entityId: log.id,
      after: {
        equipment_id: equipment.id,
        kind: "service",
        performed_at: "2026-02-01T09:00:00.000Z",
        performed_by: fixture.actorId,
        notes: "replaced the filter",
        file_object_id: null,
      },
    });
  });

  it("accepts a repair and an inspection", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    expect((await recordService(store, fixture, equipment, { kind: "repair" })).kind).toBe(
      "repair",
    );
    expect((await recordService(store, fixture, equipment, { kind: "inspection" })).kind).toBe(
      "inspection",
    );
  });

  it("trims a padded kind before the vocabulary check", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    // The web parser trims, so a direct caller passing " service" must agree
    // rather than get a DomainError the API would have accepted.
    const log = await recordService(store, fixture, equipment, { kind: "  service  " });

    expect(log.kind).toBe("service");
    expect(store.maintenanceLogs.size).toBe(1);
  });

  it("rejects a bad kind, a malformed instant or a blank operator/equipment without writing", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);

    await expect(recordService(store, fixture, equipment, { kind: "cleaning" })).rejects.toThrow(
      DomainError,
    );
    await expect(
      recordService(store, fixture, equipment, { performedAt: "yesterday" }),
    ).rejects.toThrow(/performedAt must be an ISO-8601 instant/);
    await expect(recordService(store, fixture, equipment, { performedBy: "  " })).rejects.toThrow(
      DomainError,
    );
    await expect(recordService(store, fixture, equipment, { equipmentId: "" })).rejects.toThrow(
      DomainError,
    );

    expect(store.maintenanceLogs.size).toBe(0);
    expect(
      store.audits.filter((row) => row.action === "hms.maintenance_log.recorded"),
    ).toHaveLength(0);
  });

  it("reports an unregistered or cross-organization equipment id as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await registerIceMachine(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      code: "eq-other",
    });

    await expect(
      recordMaintenanceLog(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        equipmentId: "missing",
        kind: "service",
        performedAt: "2026-02-01T09:00:00.000Z",
        performedBy: fixture.actorId,
      }),
    ).rejects.toThrow(NotFoundError);
    // A cross-organization id does not leak: the resolve is org-scoped, so the
    // foreign row is invisible before the append.
    await expect(
      recordMaintenanceLog(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        equipmentId: other.id,
        kind: "service",
        performedAt: "2026-02-01T09:00:00.000Z",
        performedBy: fixture.actorId,
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.maintenanceLogs.size).toBe(0);
    expect(
      store.audits.filter((row) => row.action === "hms.maintenance_log.recorded"),
    ).toHaveLength(0);
  });
});

describe("findEquipment and findMaintenanceLog", () => {
  it("return the row for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const equipment = await registerIceMachine(store, fixture);
    const log = await recordService(store, fixture, equipment);
    const otherEquipment = await registerIceMachine(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      code: "eq-other",
    });
    const otherLog = await recordService(store, fixture, otherEquipment, {
      organizationId: fixture.otherOrganizationId,
    });

    expect(
      (
        await findEquipment(store, {
          organizationId: fixture.organizationId,
          equipmentId: equipment.id,
        })
      )?.id,
    ).toBe(equipment.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findEquipment(store, {
        organizationId: fixture.organizationId,
        equipmentId: otherEquipment.id,
      }),
    ).toBeUndefined();
    expect(
      await findEquipment(store, {
        organizationId: fixture.organizationId,
        equipmentId: "missing",
      }),
    ).toBeUndefined();

    expect(
      (
        await findMaintenanceLog(store, {
          organizationId: fixture.organizationId,
          maintenanceLogId: log.id,
        })
      )?.id,
    ).toBe(log.id);
    expect(
      await findMaintenanceLog(store, {
        organizationId: fixture.organizationId,
        maintenanceLogId: otherLog.id,
      }),
    ).toBeUndefined();
    expect(
      await findMaintenanceLog(store, {
        organizationId: fixture.organizationId,
        maintenanceLogId: "missing",
      }),
    ).toBeUndefined();
  });
});

describe("listEquipment and listMaintenanceLogs", () => {
  it("lists equipment by code with filters and paging, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const beta = await registerIceMachine(store, fixture, { code: "eq-b" });
    const alpha = await registerIceMachine(store, fixture, { code: "eq-a", kind: "oven" });
    const retired = await registerIceMachine(store, fixture, {
      code: "eq-c",
      kind: "oven",
      active: false,
    });
    const otherOrg = await registerIceMachine(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      code: "eq-a",
    });

    // Code ascending; the exact id list fails if the org filter were dropped
    // (the other organization's row would be appended).
    expect(
      (await listEquipment(store, { organizationId: fixture.organizationId })).map((row) => row.id),
    ).toEqual([alpha.id, beta.id, retired.id]);
    expect(
      (await listEquipment(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([otherOrg.id]);

    expect(
      (await listEquipment(store, { organizationId: fixture.organizationId, kind: "oven" })).map(
        (row) => row.id,
      ),
    ).toEqual([alpha.id, retired.id]);
    expect(
      (await listEquipment(store, { organizationId: fixture.organizationId, active: true })).map(
        (row) => row.id,
      ),
    ).toEqual([alpha.id, beta.id]);
    expect(
      (
        await listEquipment(store, {
          organizationId: fixture.organizationId,
          locationId: "loc-none",
        })
      ).map((row) => row.id),
    ).toEqual([]);
    expect(
      (
        await listEquipment(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([beta.id]);
  });

  it("lists maintenance logs newest first with filters and paging, scoped to the organization", async () => {
    const { store, fixture } = setup();
    const first = await registerIceMachine(store, fixture, { code: "eq-a" });
    const second = await registerIceMachine(store, fixture, { code: "eq-b" });
    const older = await recordService(store, fixture, first, {
      performedAt: "2026-01-01T09:00:00.000Z",
    });
    const newer = await recordService(store, fixture, first, {
      kind: "inspection",
      performedAt: "2026-03-01T09:00:00.000Z",
    });
    const other = await recordService(store, fixture, second, {
      performedAt: "2026-02-01T09:00:00.000Z",
    });
    const foreignEquipment = await registerIceMachine(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      locationId: fixture.otherLocationId,
      code: "eq-foreign",
    });
    const foreign = await recordService(store, fixture, foreignEquipment, {
      organizationId: fixture.otherOrganizationId,
      performedAt: "2026-04-01T09:00:00.000Z",
    });

    // Newest performed_at first; the exact id list fails if the org filter were
    // dropped (the foreign, newest row would be first).
    expect(
      (await listMaintenanceLogs(store, { organizationId: fixture.organizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([newer.id, other.id, older.id]);
    expect(
      (await listMaintenanceLogs(store, { organizationId: fixture.otherOrganizationId })).map(
        (row) => row.id,
      ),
    ).toEqual([foreign.id]);

    expect(
      (
        await listMaintenanceLogs(store, {
          organizationId: fixture.organizationId,
          equipmentId: first.id,
        })
      ).map((row) => row.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (
        await listMaintenanceLogs(store, {
          organizationId: fixture.organizationId,
          kind: "service",
        })
      ).map((row) => row.id),
    ).toEqual([other.id, older.id]);
    expect(
      (
        await listMaintenanceLogs(store, {
          organizationId: fixture.organizationId,
          limit: 1,
          offset: 1,
        })
      ).map((row) => row.id),
    ).toEqual([other.id]);
  });
});
