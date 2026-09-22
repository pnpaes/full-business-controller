import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  auditEvent,
  createDb,
  createMaintenanceLog as createMaintenanceLogRow,
  location,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildComplianceExport } from "./build-compliance-export";
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
import { createPostgresHmsStore } from "./postgres-store";
import { recordChecklistRun } from "./record-checklist-run";
import { recordCorrectiveAction } from "./record-corrective-action";
import { recordMaintenanceLog } from "./record-maintenance-log";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerChecklistTemplate } from "./register-checklist-template";
import { registerEquipment } from "./register-equipment";
import { registerIncident } from "./register-incident";
import { registerMonitoringPoint } from "./register-monitoring-point";
import { updateChecklistRun } from "./update-checklist-run";
import { updateChecklistTemplate } from "./update-checklist-template";
import { updateCorrectiveAction } from "./update-corrective-action";
import { updateEquipment } from "./update-equipment";
import { updateIncident } from "./update-incident";
import { updateMonitoringPoint } from "./update-monitoring-point";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

async function seedLocation(tx: DatabaseTransaction, orgId: string, code: string): Promise<string> {
  const rows = await tx
    .insert(location)
    .values({ organizationId: orgId, code, name: "HMS IT location" })
    .returning();
  return rows[0]!.id;
}

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

/** Awaits `operation` expecting it to reject, returning the underlying driver error. */
async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
}

describe.skipIf(!databaseUrl)("HMS monitoring against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`HMS IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every point and reading (and the location) is created inside a
      // rolled-back transaction, so only the organization is committed.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("registers a point and records in-range and out-of-range readings", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();

      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `fridge_${suffix}`,
        name: "Walk-in fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "twice_daily",
      });
      expect(point).toMatchObject({
        organizationId: orgId,
        locationId,
        code: `fridge_${suffix}`,
        unit: "celsius",
        active: true,
        createdBy: actorId,
      });

      const found = await store.findMonitoringPoint({
        organizationId: orgId,
        monitoringPointId: point.id,
      });
      expect(found?.targetMax).toBe("4.000000");

      const inRange = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "3.5",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });
      const outOfRange = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "9",
        measuredAt: "2026-02-01T20:00:00.000Z",
        notes: "door left open",
      });
      expect(inRange).toMatchObject({ value: "3.500000", unit: "celsius", inRange: true });
      expect(outOfRange).toMatchObject({ value: "9.000000", unit: "celsius", inRange: false });

      const listed = await listMonitoringReadings(store, { organizationId: orgId });
      expect(listed.map((row) => row.id)).toEqual([outOfRange.id, inRange.id]);

      const points = await listMonitoringPoints(store, { organizationId: orgId });
      expect(points.map((row) => row.id)).toEqual([point.id]);
    });
  });

  it("keeps a second organization's points and readings out of scope", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT other ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_other_${suffix}`);
      const otherPoint = await registerMonitoringPoint(store, {
        organizationId: otherOrgId,
        actorId,
        locationId: otherLocationId,
        code: `freezer_${suffix}`,
        name: "Chest freezer",
        kind: "freezer",
        unit: "celsius",
        targetMin: "-20",
        targetMax: "-15",
        checkFrequency: "daily",
      });

      expect(
        await store.findMonitoringPoint({
          organizationId: orgId,
          monitoringPointId: otherPoint.id,
        }),
      ).toBeUndefined();
      expect(
        (await listMonitoringPoints(store, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(otherPoint.id);

      await expect(
        recordMonitoringReading(store, {
          organizationId: orgId,
          actorId,
          monitoringPointId: otherPoint.id,
          value: "-18",
          measuredAt: "2026-02-01T08:00:00.000Z",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("updates and deactivates a point, and refuses a cross-organization edit", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_update_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();

      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `fridge_update_${suffix}`,
        name: "Walk-in fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "twice_daily",
      });

      const updated = await updateMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        name: "Walk-in fridge (front)",
        targetMin: "-1",
        targetMax: "5",
      });
      expect(updated).toMatchObject({
        id: point.id,
        code: `fridge_update_${suffix}`,
        name: "Walk-in fridge (front)",
        targetMin: "-1.000000",
        targetMax: "5.000000",
        active: true,
      });

      const deactivated = await updateMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        active: false,
      });
      expect(deactivated?.active).toBe(false);

      const found = await findMonitoringPoint(store, {
        organizationId: orgId,
        monitoringPointId: point.id,
      });
      expect(found).toMatchObject({ name: "Walk-in fridge (front)", active: false });

      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT update other ${suffix}` })
        .returning();
      await expect(
        updateMonitoringPoint(store, {
          organizationId: otherOrg[0]!.id,
          actorId,
          monitoringPointId: point.id,
          name: "Hijacked",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("registers, closes and reopens an incident against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_inc_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();

      const incident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId,
        category: "near_miss",
        severity: "high",
        occurredAt: "2026-02-01T10:00:00.000Z",
        reportedAt: "2026-02-01T10:05:00.000Z",
        reportedBy: actorId,
        title: "Pallets stacked too high",
        involvesPersonalData: false,
      });
      expect(incident).toMatchObject({
        organizationId: orgId,
        locationId,
        category: "near_miss",
        severity: "high",
        status: "open",
        closedAt: null,
        createdBy: actorId,
      });

      expect(
        (await findIncident(store, { organizationId: orgId, incidentId: incident.id }))?.id,
      ).toBe(incident.id);

      const closed = await updateIncident(store, {
        organizationId: orgId,
        actorId,
        incidentId: incident.id,
        status: "closed",
      });
      expect(closed.status).toBe("closed");
      expect(closed.closedAt).not.toBeNull();
      expect(closed.updatedBy).toBe(actorId);

      const reopened = await updateIncident(store, {
        organizationId: orgId,
        actorId,
        incidentId: incident.id,
        status: "investigating",
      });
      expect(reopened.status).toBe("investigating");
      expect(reopened.closedAt).toBeNull();
      expect(reopened.updatedBy).toBe(actorId);

      const listed = await listIncidents(store, { organizationId: orgId });
      expect(listed.map((row) => row.id)).toEqual([incident.id]);
    });
  });

  it("records and advances a corrective action against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_action_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const verifierId = randomUUID();

      const incident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-01T10:00:00.000Z",
        reportedAt: "2026-02-01T10:05:00.000Z",
        reportedBy: actorId,
        title: "Pallets stacked too high",
        involvesPersonalData: false,
      });

      const action = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: incident.id,
        description: "Re-stack the pallets lower",
        dueDate: "2026-02-15",
      });
      expect(action).toMatchObject({
        organizationId: orgId,
        incidentId: incident.id,
        monitoringReadingId: null,
        status: "open",
        completedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        createdBy: actorId,
      });

      const done = await updateCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        correctiveActionId: action.id,
        status: "done",
      });
      expect(done.status).toBe("done");
      expect(done.completedAt).not.toBeNull();
      expect(done.updatedBy).toBe(actorId);

      const verified = await updateCorrectiveAction(store, {
        organizationId: orgId,
        actorId: verifierId,
        correctiveActionId: action.id,
        status: "verified",
      });
      expect(verified.status).toBe("verified");
      expect(verified.verifiedBy).toBe(verifierId);
      expect(verified.verifiedAt).not.toBeNull();
      expect(verified.completedAt).toBe(done.completedAt);
      expect(verified.updatedBy).toBe(verifierId);

      expect(
        (
          await findCorrectiveAction(store, {
            organizationId: orgId,
            correctiveActionId: action.id,
          })
        )?.status,
      ).toBe("verified");
      const listed = await listCorrectiveActions(store, {
        organizationId: orgId,
        incidentId: incident.id,
      });
      expect(listed.map((row) => row.id)).toEqual([action.id]);
    });
  });

  it("refuses an incident at another organization's location (0040 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT guard other ${suffix}` })
        .returning();
      const otherLocationId = await seedLocation(tx, otherOrg[0]!.id, `hms_guard_${suffix}`);

      const cause = await rejectionCause(
        registerIncident(store, {
          organizationId: orgId,
          actorId,
          locationId: otherLocationId,
          category: "other",
          severity: "low",
          occurredAt: "2026-02-01T10:00:00.000Z",
          reportedAt: "2026-02-01T10:05:00.000Z",
          reportedBy: actorId,
          title: "Wrong organization location",
          involvesPersonalData: false,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/hms_incident\.location_id/);
    });
  });

  it("refuses a corrective action linked to another organization's incident (0041 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT guard other action ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_guard_action_${suffix}`);
      const otherIncident = await registerIncident(store, {
        organizationId: otherOrgId,
        actorId,
        locationId: otherLocationId,
        category: "other",
        severity: "low",
        occurredAt: "2026-02-01T10:00:00.000Z",
        reportedAt: "2026-02-01T10:05:00.000Z",
        reportedBy: actorId,
        title: "Other tenant incident",
        involvesPersonalData: false,
      });

      const cause = await rejectionCause(
        recordCorrectiveAction(store, {
          organizationId: orgId,
          actorId,
          incidentId: otherIncident.id,
          description: "Cross-organization action",
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/corrective_action\.incident_id/);
    });
  });

  it("registers, revises and updates a checklist template against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const editorId = randomUUID();

      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: "Daily cleaning",
        category: "cleaning",
        frequency: "daily",
        items: [{ key: "floor", label: "Mop the floor" }],
      });
      expect(template).toMatchObject({
        organizationId: orgId,
        name: "Daily cleaning",
        category: "cleaning",
        frequency: "daily",
        active: true,
        supersedesId: null,
        createdBy: actorId,
      });

      const updated = await updateChecklistTemplate(store, {
        organizationId: orgId,
        actorId: editorId,
        templateId: template.id,
        name: "Daily cleaning (front)",
        frequency: "twice_daily",
        items: [{ key: "floor", label: "Mop the floor", required: true }],
      });
      expect(updated).toMatchObject({
        id: template.id,
        name: "Daily cleaning (front)",
        frequency: "twice_daily",
        active: true,
        createdBy: actorId,
        updatedBy: editorId,
      });
      expect(updated.items).toEqual([{ key: "floor", label: "Mop the floor", required: true }]);

      const revision = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: "Daily cleaning (v2)",
        category: "cleaning",
        frequency: "daily",
        items: [],
        supersedesId: template.id,
      });
      expect(revision.supersedesId).toBe(template.id);

      expect(
        (
          await findChecklistTemplate(store, {
            organizationId: orgId,
            templateId: template.id,
          })
        )?.id,
      ).toBe(template.id);
      expect(
        (await listChecklistTemplates(store, { organizationId: orgId })).map((row) => row.id),
      ).toEqual(expect.arrayContaining([template.id, revision.id]));
    });
  });

  it("records and updates a checklist run against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_check_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const editorId = randomUUID();

      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: "Opening routine",
        category: "opening",
        frequency: "daily",
        items: [{ key: "lights", label: "Switch on the lights" }],
      });
      const runAt = "2026-02-01T08:00:00.000Z";

      const run = await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId,
        runAt,
        performedBy: actorId,
        results: [{ key: "lights", outcome: "pass" }],
      });
      expect(run).toMatchObject({
        organizationId: orgId,
        templateId: template.id,
        locationId,
        runAt,
        performedBy: actorId,
        status: "in_progress",
        notes: null,
        createdBy: actorId,
      });
      expect(run.results).toEqual([{ key: "lights", outcome: "pass" }]);

      const updated = await updateChecklistRun(store, {
        organizationId: orgId,
        actorId: editorId,
        runId: run.id,
        status: "completed",
        results: [{ key: "lights", outcome: "fail", note: "bulb out" }],
        notes: "reported to the manager",
      });
      expect(updated).toMatchObject({
        status: "completed",
        notes: "reported to the manager",
        createdBy: actorId,
        updatedBy: editorId,
      });
      // The run's own instant is immutable; there is no completion instant.
      expect(updated.runAt).toBe(runAt);

      expect((await findChecklistRun(store, { organizationId: orgId, runId: run.id }))?.id).toBe(
        run.id,
      );
      expect(
        (
          await listChecklistRuns(store, {
            organizationId: orgId,
            templateId: template.id,
          })
        ).map((row) => row.id),
      ).toEqual([run.id]);
    });
  });

  it("keeps another organization's checklist rows out of scope", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT checklist other ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_check_other_${suffix}`);

      const otherTemplate = await registerChecklistTemplate(store, {
        organizationId: otherOrgId,
        actorId,
        name: "Other tenant routine",
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      const otherRun = await recordChecklistRun(store, {
        organizationId: otherOrgId,
        actorId,
        templateId: otherTemplate.id,
        locationId: otherLocationId,
        runAt: "2026-02-01T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });

      expect(
        await store.findChecklistTemplate({
          organizationId: orgId,
          templateId: otherTemplate.id,
        }),
      ).toBeUndefined();
      expect(
        await store.findChecklistRun({ organizationId: orgId, runId: otherRun.id }),
      ).toBeUndefined();
      // The org filter is load-bearing: these lists would contain the other
      // tenant's row if it were dropped.
      expect(
        (await listChecklistTemplates(store, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(otherTemplate.id);
      expect(
        (await listChecklistRuns(store, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(otherRun.id);

      await expect(
        updateChecklistTemplate(store, {
          organizationId: orgId,
          actorId,
          templateId: otherTemplate.id,
          name: "Hijacked",
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        updateChecklistRun(store, {
          organizationId: orgId,
          actorId,
          runId: otherRun.id,
          status: "completed",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("refuses a run referencing another organization's template (org-scoped read)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const ownLocationId = await seedLocation(tx, orgId, `hms_check_guard_${suffix}`);
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT checklist guard other ${suffix}` })
        .returning();
      const otherTemplate = await registerChecklistTemplate(store, {
        organizationId: otherOrg[0]!.id,
        actorId,
        name: "Other guard routine",
        category: "cleaning",
        frequency: "daily",
        items: [],
      });

      // The template is resolved organization-scoped before the insert, so a
      // foreign id is a typed miss. The `checklist_run.template_id` 23514 guard
      // remains as a backstop and is exercised directly in the persistence
      // suite (`checklists.postgres.test.ts`).
      await expect(
        recordChecklistRun(store, {
          organizationId: orgId,
          actorId,
          templateId: otherTemplate.id,
          locationId: ownLocationId,
          runAt: "2026-02-01T08:00:00.000Z",
          performedBy: actorId,
          results: [],
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("refuses a run at another organization's location (0043 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const ownTemplate = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: "Own guard routine",
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT checklist guard loc ${suffix}` })
        .returning();
      const otherLocationId = await seedLocation(tx, otherOrg[0]!.id, `hms_guard_loc_${suffix}`);

      const cause = await rejectionCause(
        recordChecklistRun(store, {
          organizationId: orgId,
          actorId,
          templateId: ownTemplate.id,
          locationId: otherLocationId,
          runAt: "2026-02-01T08:00:00.000Z",
          performedBy: actorId,
          results: [],
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_run\.location_id/);
    });
  });

  it("registers, updates and lists equipment against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_eq_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const editorId = randomUUID();

      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `eq_${suffix}`,
        name: "Ice machine",
        kind: "refrigeration",
        serialNo: "SN-123",
        installedAt: "2025-05-01",
        warrantyUntil: "2027-05-01",
      });
      expect(equipment).toMatchObject({
        organizationId: orgId,
        locationId,
        code: `eq_${suffix}`,
        name: "Ice machine",
        kind: "refrigeration",
        serialNo: "SN-123",
        installedAt: "2025-05-01",
        warrantyUntil: "2027-05-01",
        active: true,
        createdBy: actorId,
      });

      const found = await findEquipment(store, {
        organizationId: orgId,
        equipmentId: equipment.id,
      });
      expect(found).toMatchObject({ installedAt: "2025-05-01", active: true, createdBy: actorId });

      const updated = await updateEquipment(store, {
        organizationId: orgId,
        actorId: editorId,
        equipmentId: equipment.id,
        name: "Ice machine (bar)",
        active: false,
        warrantyUntil: null,
      });
      expect(updated).toMatchObject({
        id: equipment.id,
        code: `eq_${suffix}`,
        name: "Ice machine (bar)",
        active: false,
        warrantyUntil: null,
        createdBy: actorId,
        updatedBy: editorId,
      });

      const listed = await listEquipment(store, { organizationId: orgId });
      expect(listed.map((row) => row.id)).toEqual([equipment.id]);
      expect(listed[0]?.installedAt).toBe("2025-05-01");
    });
  });

  it("records maintenance logs against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_log_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const technicianId = randomUUID();

      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `eq_log_${suffix}`,
        name: "Ice machine",
        kind: "refrigeration",
      });

      const older = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "service",
        performedAt: "2026-01-01T09:00:00.000Z",
        performedBy: technicianId,
      });
      const newer = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "inspection",
        performedAt: "2026-03-01T09:00:00.000Z",
        performedBy: technicianId,
        notes: "annual check",
      });
      expect(older).toMatchObject({
        organizationId: orgId,
        equipmentId: equipment.id,
        kind: "service",
        performedAt: "2026-01-01T09:00:00.000Z",
        performedBy: technicianId,
        fileObjectId: null,
        createdBy: actorId,
      });
      // `created_by` is the acting actor, not the technician who performed it.
      expect(newer.createdBy).toBe(actorId);

      const found = await findMaintenanceLog(store, {
        organizationId: orgId,
        maintenanceLogId: older.id,
      });
      expect(found?.kind).toBe("service");

      const listed = await listMaintenanceLogs(store, { organizationId: orgId });
      expect(listed.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(
        (await listMaintenanceLogs(store, { organizationId: orgId, kind: "service" })).map(
          (row) => row.id,
        ),
      ).toEqual([older.id]);
    });
  });

  it("keeps another organization's equipment and maintenance logs out of scope", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT eq other ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_eq_other_${suffix}`);
      const ownLocationId = await seedLocation(tx, orgId, `hms_eq_own_${suffix}`);

      const otherEquipment = await registerEquipment(store, {
        organizationId: otherOrgId,
        actorId,
        locationId: otherLocationId,
        code: `eq_other_${suffix}`,
        name: "Other tenant machine",
        kind: "refrigeration",
      });
      const otherLog = await recordMaintenanceLog(store, {
        organizationId: otherOrgId,
        actorId,
        equipmentId: otherEquipment.id,
        kind: "service",
        performedAt: "2026-02-01T09:00:00.000Z",
        performedBy: actorId,
      });
      const ownEquipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId: ownLocationId,
        code: `eq_own_${suffix}`,
        name: "Own machine",
        kind: "refrigeration",
      });

      expect(
        await findEquipment(store, { organizationId: orgId, equipmentId: otherEquipment.id }),
      ).toBeUndefined();
      expect(
        await findMaintenanceLog(store, { organizationId: orgId, maintenanceLogId: otherLog.id }),
      ).toBeUndefined();
      // The org filter is load-bearing: these lists would contain the other
      // tenant's rows if it were dropped.
      expect((await listEquipment(store, { organizationId: orgId })).map((row) => row.id)).toEqual([
        ownEquipment.id,
      ]);
      expect(
        (await listMaintenanceLogs(store, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([]);

      await expect(
        updateEquipment(store, {
          organizationId: orgId,
          actorId,
          equipmentId: otherEquipment.id,
          name: "Hijacked",
        }),
      ).rejects.toThrow(NotFoundError);
      // The equipment resolve is org-scoped, so a foreign id cannot be logged.
      await expect(
        recordMaintenanceLog(store, {
          organizationId: orgId,
          actorId,
          equipmentId: otherEquipment.id,
          kind: "service",
          performedAt: "2026-02-01T09:00:00.000Z",
          performedBy: actorId,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("refuses equipment at another organization's location (0045 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT eq guard other ${suffix}` })
        .returning();
      const otherLocationId = await seedLocation(tx, otherOrg[0]!.id, `hms_eq_guard_${suffix}`);

      const cause = await rejectionCause(
        registerEquipment(store, {
          organizationId: orgId,
          actorId,
          locationId: otherLocationId,
          code: `eq_guard_${suffix}`,
          name: "Wrong organization location",
          kind: "refrigeration",
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/equipment\.location_id/);
    });
  });

  it("refuses a maintenance log for another organization's equipment (0045 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT log guard other ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_log_guard_loc_${suffix}`);
      const otherEquipment = await registerEquipment(store, {
        organizationId: otherOrgId,
        actorId,
        locationId: otherLocationId,
        code: `eq_log_guard_${suffix}`,
        name: "Other tenant machine",
        kind: "refrigeration",
      });

      // The command resolves the equipment organization-scoped and refuses the
      // foreign id as a typed miss before the insert; bypass the command to
      // exercise the `maintenance_log.equipment_id` 23514 backstop directly.
      const cause = await rejectionCause(
        createMaintenanceLogRow(tx, {
          organizationId: orgId,
          equipmentId: otherEquipment.id,
          kind: "service",
          performedAt: new Date("2026-02-01T09:00:00.000Z"),
          performedBy: actorId,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/maintenance_log\.equipment_id/);
    });
  });

  it("refuses a duplicate equipment code (23505)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const locationId = await seedLocation(tx, orgId, `hms_eq_dup_${suffix}`);
      const code = `eq_dup_${suffix}`;

      await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code,
        name: "First machine",
        kind: "refrigeration",
      });
      const cause = await rejectionCause(
        registerEquipment(store, {
          organizationId: orgId,
          actorId,
          locationId,
          code,
          name: "Second machine",
          kind: "refrigeration",
        }),
      );
      expect(errorCode(cause)).toBe("23505");
    });
  });

  it("applies inclusive period windows to the five list queries", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_period_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `fridge_period_${suffix}`,
        name: "Period fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      const reading = (measuredAt: string, value: string) =>
        recordMonitoringReading(store, {
          organizationId: orgId,
          actorId,
          monitoringPointId: point.id,
          value,
          measuredAt,
        });
      const janReading = await reading("2026-01-01T08:00:00.000Z", "1");
      const febReading = await reading("2026-02-01T08:00:00.000Z", "2");
      const marReading = await reading("2026-03-01T08:00:00.000Z", "3");

      const incident = (occurredAt: string, title: string) =>
        registerIncident(store, {
          organizationId: orgId,
          actorId,
          locationId,
          category: "near_miss",
          severity: "medium",
          occurredAt,
          reportedAt: occurredAt,
          reportedBy: actorId,
          title,
          involvesPersonalData: false,
        });
      const janIncident = await incident("2026-01-01T10:00:00.000Z", "January");
      await incident("2026-02-01T10:00:00.000Z", "February");
      const marIncident = await incident("2026-03-01T10:00:00.000Z", "March");

      const action = (incidentId: string, dueDate: string, description: string) =>
        recordCorrectiveAction(store, {
          organizationId: orgId,
          actorId,
          incidentId,
          description,
          dueDate,
        });
      await action(janIncident.id, "2026-01-15", "January action");
      const febAction = await action(janIncident.id, "2026-02-15", "February action");
      const marAction = await action(marIncident.id, "2026-03-15", "March action");

      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: `Period routine ${suffix}`,
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      const run = (runAt: string) =>
        recordChecklistRun(store, {
          organizationId: orgId,
          actorId,
          templateId: template.id,
          locationId,
          runAt,
          performedBy: actorId,
          results: [],
        });
      await run("2026-01-01T08:00:00.000Z");
      const febRun = await run("2026-02-01T08:00:00.000Z");
      const marRun = await run("2026-03-01T08:00:00.000Z");

      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `eq_period_${suffix}`,
        name: "Period machine",
        kind: "refrigeration",
      });
      const log = (performedAt: string) =>
        recordMaintenanceLog(store, {
          organizationId: orgId,
          actorId,
          equipmentId: equipment.id,
          kind: "service",
          performedAt,
          performedBy: actorId,
        });
      await log("2026-01-01T09:00:00.000Z");
      const febLog = await log("2026-02-01T09:00:00.000Z");
      const marLog = await log("2026-03-01T09:00:00.000Z");

      // Both bounds inclusive; newest first for the instant columns.
      expect(
        (
          await listMonitoringReadings(store, {
            organizationId: orgId,
            from: "2026-02-01T08:00:00.000Z",
            to: "2026-03-01T08:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toEqual([marReading.id, febReading.id]);
      expect(
        (
          await listMonitoringReadings(store, {
            organizationId: orgId,
            from: "2026-02-01T08:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toEqual([marReading.id, febReading.id]);
      expect(
        (
          await listMonitoringReadings(store, {
            organizationId: orgId,
            to: "2026-01-01T08:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toEqual([janReading.id]);

      expect(
        (await listIncidents(store, { organizationId: orgId, to: "2026-02-01T10:00:00.000Z" })).map(
          (row) => row.id,
        ),
      ).toHaveLength(2);
      expect(
        (
          await listIncidents(store, { organizationId: orgId, from: "2026-02-01T10:00:00.000Z" })
        ).map((row) => row.id),
      ).toHaveLength(2);

      // The corrective-action bound is a plain `YYYY-MM-DD` day, inclusive.
      expect(
        (
          await listCorrectiveActions(store, {
            organizationId: orgId,
            from: "2026-02-15",
            to: "2026-03-15",
          })
        ).map((row) => row.id),
      ).toEqual([febAction.id, marAction.id]);
      expect(
        (await listCorrectiveActions(store, { organizationId: orgId, to: "2026-01-15" })).map(
          (row) => row.id,
        ),
      ).toHaveLength(1);

      expect(
        (
          await listChecklistRuns(store, {
            organizationId: orgId,
            from: "2026-02-01T08:00:00.000Z",
            to: "2026-03-01T08:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toEqual([marRun.id, febRun.id]);
      expect(
        (
          await listChecklistRuns(store, { organizationId: orgId, to: "2026-02-01T08:00:00.000Z" })
        ).map((row) => row.id),
      ).toHaveLength(2);

      expect(
        (
          await listMaintenanceLogs(store, {
            organizationId: orgId,
            from: "2026-02-01T09:00:00.000Z",
            to: "2026-03-01T09:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toEqual([marLog.id, febLog.id]);
      expect(
        (
          await listMaintenanceLogs(store, {
            organizationId: orgId,
            from: "2026-02-01T09:00:00.000Z",
          })
        ).map((row) => row.id),
      ).toHaveLength(2);
    });
  });

  it("builds a compliance export with counts, provenance and one audit fact", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_export_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const technicianId = randomUUID();

      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `fridge_export_${suffix}`,
        name: "Export fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      const reading = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });
      const incident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-02T10:00:00.000Z",
        reportedAt: "2026-02-02T10:05:00.000Z",
        reportedBy: actorId,
        title: "Export incident",
        involvesPersonalData: false,
      });
      const action = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: incident.id,
        description: "Export action",
        dueDate: "2026-02-10",
      });
      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: `Export routine ${suffix}`,
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      const run = await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId,
        runAt: "2026-02-03T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });
      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `eq_export_${suffix}`,
        name: "Export machine",
        kind: "refrigeration",
      });
      const log = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "inspection",
        performedAt: "2026-02-04T09:00:00.000Z",
        performedBy: technicianId,
      });

      // A foreign organization's rows must never enter the bundle.
      const otherOrg = await tx
        .insert(organization)
        .values({ legalName: `HMS IT export other ${suffix}` })
        .returning();
      const otherOrgId = otherOrg[0]!.id;
      const otherLocationId = await seedLocation(tx, otherOrgId, `hms_export_other_${suffix}`);
      const otherPoint = await registerMonitoringPoint(store, {
        organizationId: otherOrgId,
        actorId,
        locationId: otherLocationId,
        code: `fridge_export_other_${suffix}`,
        name: "Other fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      await recordMonitoringReading(store, {
        organizationId: otherOrgId,
        actorId,
        monitoringPointId: otherPoint.id,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });

      const bundle = await buildComplianceExport(store, {
        organizationId: orgId,
        actorId,
      });

      expect(bundle.organizationId).toBe(orgId);
      expect(bundle.period).toEqual({ from: null, to: null });
      expect(bundle.counts).toEqual({
        monitoringReadings: 1,
        incidents: 1,
        correctiveActions: 1,
        checklistRuns: 1,
        maintenanceLogs: 1,
      });
      expect(bundle.truncated).toEqual({
        monitoringReadings: false,
        incidents: false,
        correctiveActions: false,
        checklistRuns: false,
        maintenanceLogs: false,
      });
      // Exact id lists: they would gain the foreign organization's rows if the
      // org filter were dropped.
      expect(bundle.monitoringReadings.map((row) => row.id)).toEqual([reading.id]);
      expect(bundle.incidents.map((row) => row.id)).toEqual([incident.id]);
      expect(bundle.correctiveActions.map((row) => row.id)).toEqual([action.id]);
      expect(bundle.checklistRuns.map((row) => row.id)).toEqual([run.id]);
      expect(bundle.maintenanceLogs.map((row) => row.id)).toEqual([log.id]);
      // Provenance ids ride on the existing view shapes.
      expect(bundle.monitoringReadings[0]?.monitoringPointId).toBe(point.id);
      expect(bundle.correctiveActions[0]?.incidentId).toBe(incident.id);
      expect(bundle.checklistRuns[0]?.templateId).toBe(template.id);
      expect(bundle.maintenanceLogs[0]?.equipmentId).toBe(equipment.id);
      expect(bundle.maintenanceLogs[0]?.fileObjectId).toBeNull();

      const exportAudits = (await tx.select().from(auditEvent)).filter(
        (row) => row.action === "hms.compliance_export.generated",
      );
      expect(exportAudits).toHaveLength(1);
      expect(exportAudits[0]).toMatchObject({
        organizationId: orgId,
        actorId,
        entityType: "hms_compliance_export",
        after: {
          scope: "organization",
          counts: {
            monitoring_readings: 1,
            incidents: 1,
            corrective_actions: 1,
            checklist_runs: 1,
            maintenance_logs: 1,
          },
        },
      });
    });
  });

  it("scopes a compliance export to the caller's locations and their parents' children", async () => {
    await inRollback(client.db, async (tx) => {
      const inLocationId = await seedLocation(tx, orgId, `hms_export_in_${suffix}`);
      const outLocationId = await seedLocation(tx, orgId, `hms_export_out_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();

      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId: inLocationId,
        code: `fridge_scope_${suffix}`,
        name: "In-scope fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      const reading = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });
      const incident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId: inLocationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-02T10:00:00.000Z",
        reportedAt: "2026-02-02T10:05:00.000Z",
        reportedBy: actorId,
        title: "In-scope incident",
        involvesPersonalData: false,
      });
      const action = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: incident.id,
        description: "In-scope action",
      });
      const standalone = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        description: "Parentless action",
      });
      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: `Scope routine ${suffix}`,
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      const run = await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId: inLocationId,
        runAt: "2026-02-03T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });
      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId: inLocationId,
        code: `eq_scope_${suffix}`,
        name: "In-scope machine",
        kind: "refrigeration",
      });
      const log = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "inspection",
        performedAt: "2026-02-04T09:00:00.000Z",
        performedBy: actorId,
      });

      // Same organization, out-of-scope location: none of this may appear.
      const outPoint = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId: outLocationId,
        code: `fridge_scope_out_${suffix}`,
        name: "Out-of-scope fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      const outReading = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: outPoint.id,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });
      const outIncident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId: outLocationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-02T10:00:00.000Z",
        reportedAt: "2026-02-02T10:05:00.000Z",
        reportedBy: actorId,
        title: "Out-of-scope incident",
        involvesPersonalData: false,
      });
      const outAction = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: outIncident.id,
        description: "Out-of-scope action",
      });
      const outRun = await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId: outLocationId,
        runAt: "2026-02-03T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });
      const outEquipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId: outLocationId,
        code: `eq_scope_out_${suffix}`,
        name: "Out-of-scope machine",
        kind: "refrigeration",
      });
      const outLog = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: outEquipment.id,
        kind: "repair",
        performedAt: "2026-02-04T09:00:00.000Z",
        performedBy: actorId,
      });

      const scoped = await buildComplianceExport(store, {
        organizationId: orgId,
        actorId,
        locationIds: [inLocationId],
      });

      expect(scoped.monitoringReadings.map((row) => row.id)).toEqual([reading.id]);
      expect(scoped.incidents.map((row) => row.id)).toEqual([incident.id]);
      expect(scoped.correctiveActions.map((row) => row.id)).toEqual([action.id]);
      expect(scoped.checklistRuns.map((row) => row.id)).toEqual([run.id]);
      expect(scoped.maintenanceLogs.map((row) => row.id)).toEqual([log.id]);
      // Children of an out-of-scope parent and a parentless action are excluded
      // (the recorded `corrective_action`/`maintenance_log` scope ceiling).
      const actionIds = scoped.correctiveActions.map((row) => row.id);
      expect(actionIds).not.toContain(outAction.id);
      expect(actionIds).not.toContain(standalone.id);
      expect(scoped.maintenanceLogs.map((row) => row.id)).not.toContain(outLog.id);
      expect(scoped.monitoringReadings.map((row) => row.id)).not.toContain(outReading.id);
      expect(scoped.checklistRuns.map((row) => row.id)).not.toContain(outRun.id);
    });
  });

  it("applies the export period through the real adapter, mapping the instant to a day", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `hms_export_period_${suffix}`);
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();

      const point = await registerMonitoringPoint(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `fridge_export_period_${suffix}`,
        name: "Export period fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "daily",
      });
      await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "1",
        measuredAt: "2026-01-01T08:00:00.000Z",
      });
      const febReading = await recordMonitoringReading(store, {
        organizationId: orgId,
        actorId,
        monitoringPointId: point.id,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
      });
      const janIncident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-01-01T10:00:00.000Z",
        reportedAt: "2026-01-01T10:05:00.000Z",
        reportedBy: actorId,
        title: "January",
        involvesPersonalData: false,
      });
      const febIncident = await registerIncident(store, {
        organizationId: orgId,
        actorId,
        locationId,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-01T10:00:00.000Z",
        reportedAt: "2026-02-01T10:05:00.000Z",
        reportedBy: actorId,
        title: "February",
        involvesPersonalData: false,
      });
      await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: janIncident.id,
        description: "January action",
        dueDate: "2026-01-30",
      });
      // Due exactly on the from calendar day: included only by the instant→day
      // mapping (a raw ISO-string compare would drop it).
      const onFromDay = await recordCorrectiveAction(store, {
        organizationId: orgId,
        actorId,
        incidentId: febIncident.id,
        description: "On the from day",
        dueDate: "2026-02-01",
      });
      const template = await registerChecklistTemplate(store, {
        organizationId: orgId,
        actorId,
        name: `Export period routine ${suffix}`,
        category: "cleaning",
        frequency: "daily",
        items: [],
      });
      await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId,
        runAt: "2026-01-01T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });
      const febRun = await recordChecklistRun(store, {
        organizationId: orgId,
        actorId,
        templateId: template.id,
        locationId,
        runAt: "2026-02-01T08:00:00.000Z",
        performedBy: actorId,
        results: [],
      });
      const equipment = await registerEquipment(store, {
        organizationId: orgId,
        actorId,
        locationId,
        code: `eq_export_period_${suffix}`,
        name: "Export period machine",
        kind: "refrigeration",
      });
      await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "service",
        performedAt: "2026-01-01T09:00:00.000Z",
        performedBy: actorId,
      });
      const febLog = await recordMaintenanceLog(store, {
        organizationId: orgId,
        actorId,
        equipmentId: equipment.id,
        kind: "service",
        performedAt: "2026-02-01T09:00:00.000Z",
        performedBy: actorId,
      });

      const bundle = await buildComplianceExport(store, {
        organizationId: orgId,
        actorId,
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-02-28T23:59:59.000Z",
      });

      expect(bundle.monitoringReadings.map((row) => row.id)).toEqual([febReading.id]);
      expect(bundle.incidents.map((row) => row.id)).toEqual([febIncident.id]);
      expect(bundle.correctiveActions.map((row) => row.id)).toEqual([onFromDay.id]);
      expect(bundle.checklistRuns.map((row) => row.id)).toEqual([febRun.id]);
      expect(bundle.maintenanceLogs.map((row) => row.id)).toEqual([febLog.id]);
      expect(bundle.counts).toEqual({
        monitoringReadings: 1,
        incidents: 1,
        correctiveActions: 1,
        checklistRuns: 1,
        maintenanceLogs: 1,
      });
    });
  });

  it("rejects a malformed or inverted export period", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresHmsStore(tx);
      const actorId = randomUUID();
      const base = { organizationId: orgId, actorId };

      await expect(
        buildComplianceExport(store, {
          ...base,
          from: "2026-03-01T00:00:00.000Z",
          to: "2026-02-01T00:00:00.000Z",
        }),
      ).rejects.toThrow(DomainError);
      await expect(buildComplianceExport(store, { ...base, from: "2026-02-01" })).rejects.toThrow(
        DomainError,
      );
      const exportAudits = (await tx.select().from(auditEvent)).filter(
        (row) => row.action === "hms.compliance_export.generated",
      );
      expect(exportAudits).toHaveLength(0);
    });
  });
});
