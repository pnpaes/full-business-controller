import { NotFoundError } from "@aquarela/domain";
import {
  createDb,
  location,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChecklistRun } from "./find-checklist-run";
import { findChecklistTemplate } from "./find-checklist-template";
import { findCorrectiveAction } from "./find-corrective-action";
import { findIncident } from "./find-incident";
import { findMonitoringPoint } from "./find-monitoring-point";
import { listChecklistRuns } from "./list-checklist-runs";
import { listChecklistTemplates } from "./list-checklist-templates";
import { listCorrectiveActions } from "./list-corrective-actions";
import { listIncidents } from "./list-incidents";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import { createPostgresHmsStore } from "./postgres-store";
import { recordChecklistRun } from "./record-checklist-run";
import { recordCorrectiveAction } from "./record-corrective-action";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerChecklistTemplate } from "./register-checklist-template";
import { registerIncident } from "./register-incident";
import { registerMonitoringPoint } from "./register-monitoring-point";
import { updateChecklistRun } from "./update-checklist-run";
import { updateChecklistTemplate } from "./update-checklist-template";
import { updateCorrectiveAction } from "./update-corrective-action";
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
});
