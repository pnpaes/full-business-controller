import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { hmsIncident, correctiveAction, location, organization } from "../schema";
import {
  createCorrectiveAction,
  createIncident,
  findCorrectiveAction,
  findIncident,
  listCorrectiveActions,
  listIncidents,
  updateCorrectiveAction,
  updateIncident,
} from "./incidents";
import { recordMonitoringReading } from "./monitoring";
import {
  createTestCorrectiveAction,
  createTestHmsIncident,
  createTestLocation,
  createTestMonitoringPoint,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

describe.skipIf(!databaseUrl)("incidents repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
  });

  afterAll(async () => {
    if (client) {
      // Every incident and corrective action is created inside a rolled-back
      // transaction, so the committed fixtures to unwind are the location and
      // the organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates an incident and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createIncident(tx, {
        organizationId: orgId,
        locationId,
        category: "near_miss",
        severity: "high",
        occurredAt: at("2026-02-01T10:00:00.000Z"),
        reportedAt: at("2026-02-01T11:30:00.000Z"),
        reportedBy: "00000000-0000-0000-0000-0000000000aa",
        ownerId: "00000000-0000-0000-0000-0000000000bb",
        title: "Pallets stacked too high",
        description: "No one was hurt",
        dueDate: "2026-02-15",
        involvesPersonalData: false,
        status: "investigating",
        actorId: "00000000-0000-0000-0000-0000000000cc",
      });
      expect(created.category).toBe("near_miss");
      expect(created.severity).toBe("high");
      expect(created.status).toBe("investigating");
      expect(created.title).toBe("Pallets stacked too high");
      expect(created.dueDate).toBe("2026-02-15");
      expect(created.involvesPersonalData).toBe(false);
      expect(created.closedAt).toBeNull();
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000cc");

      expect((await findIncident(tx, { organizationId: orgId, incidentId: created.id }))?.id).toBe(
        created.id,
      );

      // A row in another organization is invisible at this scope. If the
      // organization filter were dropped, this lookup would find the row and
      // the assertion would fail.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findIncident(tx, { organizationId: otherOrgId, incidentId: created.id }),
      ).toBeUndefined();
    });
  });

  it("leaves owner_id, description and due_date null when omitted", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createIncident(tx, {
        organizationId: orgId,
        locationId,
        category: "other",
        severity: "low",
        occurredAt: at("2026-02-02T08:00:00.000Z"),
        reportedAt: at("2026-02-02T08:05:00.000Z"),
        reportedBy: "00000000-0000-0000-0000-0000000000aa",
        title: "Standalone observation",
        involvesPersonalData: false,
        status: "open",
      });
      expect(created.ownerId).toBeNull();
      expect(created.description).toBeNull();
      expect(created.dueDate).toBeNull();
      expect(created.createdBy).toBeNull();
    });
  });

  it("lists by status and location with paging and second-org isolation", async () => {
    await inRollback(client.db, async (tx) => {
      const otherLocation = await createTestLocation(tx, orgId);
      const a = await createTestHmsIncident(tx, orgId, locationId, {
        occurredAt: at("2026-01-01T08:00:00.000Z"),
        status: "open",
      });
      const b = await createTestHmsIncident(tx, orgId, locationId, {
        occurredAt: at("2026-03-01T08:00:00.000Z"),
        status: "closed",
      });
      const c = await createTestHmsIncident(tx, orgId, otherLocation.id, {
        occurredAt: at("2026-02-01T08:00:00.000Z"),
        status: "open",
      });

      // Newest `occurred_at` first.
      const all = await listIncidents(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([b.id, c.id, a.id]);

      const open = await listIncidents(tx, { organizationId: orgId, status: "open" });
      expect(open.map((row) => row.id)).toEqual([c.id, a.id]);

      const here = await listIncidents(tx, { organizationId: orgId, locationId });
      expect(here.map((row) => row.id)).toEqual([b.id, a.id]);

      const paged = await listIncidents(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([c.id]);

      // A second organization's rows never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const other = await createTestHmsIncident(tx, otherOrgId, otherLocationId);
      expect((await listIncidents(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        b.id,
        c.id,
        a.id,
      ]);
      expect(
        (await listIncidents(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("filters incidents by an inclusive occurred_at window", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = (occurredAt: string) =>
        createTestHmsIncident(tx, orgId, locationId, { occurredAt: at(occurredAt) });
      const before = await incident("2026-01-31T23:59:59.999Z");
      const lower = await incident("2026-02-01T00:00:00.000Z");
      const inside = await incident("2026-02-15T12:00:00.000Z");
      const upper = await incident("2026-03-01T00:00:00.000Z");
      const after = await incident("2026-03-01T00:00:00.001Z");

      // Both bounds inclusive, newest first; the rows just outside are excluded.
      const windowed = await listIncidents(tx, {
        organizationId: orgId,
        from: at("2026-02-01T00:00:00.000Z"),
        to: at("2026-03-01T00:00:00.000Z"),
      });
      expect(windowed.map((row) => row.id)).toEqual([upper.id, inside.id, lower.id]);

      // An absent bound is open-ended: `from` alone leaves the upper end open...
      const fromOnly = await listIncidents(tx, {
        organizationId: orgId,
        from: at("2026-02-01T00:00:00.000Z"),
      });
      expect(fromOnly.map((row) => row.id)).toEqual([after.id, upper.id, inside.id, lower.id]);

      // ...and `to` alone leaves the lower end open.
      const toOnly = await listIncidents(tx, {
        organizationId: orgId,
        to: at("2026-03-01T00:00:00.000Z"),
      });
      expect(toOnly.map((row) => row.id)).toEqual([upper.id, inside.id, lower.id, before.id]);

      // The window composes with the location filter and paging.
      const here = await listIncidents(tx, {
        organizationId: orgId,
        locationId,
        from: at("2026-02-01T00:00:00.000Z"),
        to: at("2026-03-01T00:00:00.000Z"),
        limit: 1,
        offset: 1,
      });
      expect(here.map((row) => row.id)).toEqual([inside.id]);

      // A second organization's in-window incident never appears.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const other = await createTestHmsIncident(tx, otherOrgId, otherLocationId, {
        occurredAt: at("2026-02-10T08:00:00.000Z"),
      });
      expect(windowed.map((row) => row.id)).not.toContain(other.id);
    });
  });

  it("updates an incident's mutable fields and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId, { status: "open" });
      const updated = await updateIncident(tx, {
        organizationId: orgId,
        incidentId: incident.id,
        status: "resolved",
        closedAt: at("2026-04-01T09:00:00.000Z"),
        ownerId: null,
        actorId: "00000000-0000-0000-0000-0000000000dd",
      });
      expect(updated?.status).toBe("resolved");
      expect(updated?.closedAt?.toISOString()).toBe("2026-04-01T09:00:00.000Z");
      expect(updated?.ownerId).toBeNull();
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000dd");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("does not update an incident through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId, { title: "Original" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateIncident(tx, {
          organizationId: otherOrgId,
          incidentId: incident.id,
          title: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (await findIncident(tx, { organizationId: orgId, incidentId: incident.id }))?.title,
      ).toBe("Original");
    });
  });

  it("rejects an incident category outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestHmsIncident(tx, orgId, locationId, { category: "explosion" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/hms_incident_category_check/);
    });
  });

  it("rejects an incident severity outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestHmsIncident(tx, orgId, locationId, { severity: "catastrophic" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/hms_incident_severity_check/);
    });
  });

  it("rejects an incident status outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestHmsIncident(tx, orgId, locationId, { status: "pending" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/hms_incident_status_check/);
    });
  });

  it("rejects an incident whose location is in another organization (0040)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `location` row (so the single-column FK passes), but
      // the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(createTestHmsIncident(tx, orgId, otherLocation.id));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/hms_incident\.location_id/);
    });
  });

  it("creates corrective actions with neither, either or both links", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId);
      const point = await createTestMonitoringPoint(tx, orgId, locationId);
      const reading = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "9",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: false,
      });

      const standalone = await createCorrectiveAction(tx, {
        organizationId: orgId,
        description: "Standalone improvement",
        status: "open",
        actorId: "00000000-0000-0000-0000-0000000000ee",
      });
      expect(standalone.incidentId).toBeNull();
      expect(standalone.monitoringReadingId).toBeNull();
      expect(standalone.ownerId).toBeNull();
      expect(standalone.dueDate).toBeNull();
      expect(standalone.createdBy).toBe("00000000-0000-0000-0000-0000000000ee");

      const fromIncident = await createTestCorrectiveAction(tx, orgId, {
        incidentId: incident.id,
      });
      expect(fromIncident.incidentId).toBe(incident.id);
      expect(fromIncident.monitoringReadingId).toBeNull();

      const fromReading = await createTestCorrectiveAction(tx, orgId, {
        monitoringReadingId: reading.id,
      });
      expect(fromReading.monitoringReadingId).toBe(reading.id);
      expect(fromReading.incidentId).toBeNull();

      const fromBoth = await createTestCorrectiveAction(tx, orgId, {
        incidentId: incident.id,
        monitoringReadingId: reading.id,
      });
      expect(fromBoth.incidentId).toBe(incident.id);
      expect(fromBoth.monitoringReadingId).toBe(reading.id);

      expect(
        (
          await findCorrectiveAction(tx, {
            organizationId: orgId,
            correctiveActionId: standalone.id,
          })
        )?.id,
      ).toBe(standalone.id);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findCorrectiveAction(tx, {
          organizationId: otherOrgId,
          correctiveActionId: standalone.id,
        }),
      ).toBeUndefined();
    });
  });

  it("lists corrective actions by incident, status and owner, earliest due first", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId);
      const owner = "00000000-0000-0000-0000-0000000000ff";
      const due = await createTestCorrectiveAction(tx, orgId, {
        incidentId: incident.id,
        dueDate: "2026-03-01",
        status: "open",
        ownerId: owner,
      });
      const sooner = await createTestCorrectiveAction(tx, orgId, {
        incidentId: incident.id,
        dueDate: "2026-02-01",
        status: "in_progress",
        ownerId: owner,
      });
      const noDue = await createTestCorrectiveAction(tx, orgId, {
        incidentId: incident.id,
        status: "done",
      });

      const byIncident = await listCorrectiveActions(tx, {
        organizationId: orgId,
        incidentId: incident.id,
      });
      expect(byIncident.map((row) => row.id)).toEqual([sooner.id, due.id, noDue.id]);

      const openOnly = await listCorrectiveActions(tx, { organizationId: orgId, status: "open" });
      expect(openOnly.map((row) => row.id)).toEqual([due.id]);

      const byOwner = await listCorrectiveActions(tx, { organizationId: orgId, ownerId: owner });
      expect(byOwner.map((row) => row.id)).toEqual([sooner.id, due.id]);

      const paged = await listCorrectiveActions(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([due.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherIncident = await createTestHmsIncident(tx, otherOrgId, otherLocationId);
      const other = await createTestCorrectiveAction(tx, otherOrgId, {
        incidentId: otherIncident.id,
      });
      expect(
        (await listCorrectiveActions(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("filters corrective actions by an inclusive due_date window", async () => {
    await inRollback(client.db, async (tx) => {
      const action = (dueDate: string) =>
        createTestCorrectiveAction(tx, orgId, { dueDate, status: "open" });
      const before = await action("2026-01-31");
      const lower = await action("2026-02-01");
      const inside = await action("2026-02-15");
      const upper = await action("2026-03-01");
      const after = await action("2026-03-02");
      const noDue = await createTestCorrectiveAction(tx, orgId, { status: "open" });

      // `due_date` is a `date` column compared as a calendar day: the exact end
      // days are included, the days either side excluded, earliest first.
      const windowed = await listCorrectiveActions(tx, {
        organizationId: orgId,
        from: "2026-02-01",
        to: "2026-03-01",
      });
      expect(windowed.map((row) => row.id)).toEqual([lower.id, inside.id, upper.id]);
      // A null due date cannot satisfy a bounded window.
      expect(windowed.map((row) => row.id)).not.toContain(noDue.id);

      // An absent bound is open-ended on that side.
      const fromOnly = await listCorrectiveActions(tx, {
        organizationId: orgId,
        from: "2026-02-15",
      });
      expect(fromOnly.map((row) => row.id)).toEqual([inside.id, upper.id, after.id]);

      const toOnly = await listCorrectiveActions(tx, {
        organizationId: orgId,
        to: "2026-02-01",
      });
      expect(toOnly.map((row) => row.id)).toEqual([before.id, lower.id]);

      // The window composes with the status filter and paging.
      const paged = await listCorrectiveActions(tx, {
        organizationId: orgId,
        status: "open",
        from: "2026-02-01",
        to: "2026-03-01",
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([inside.id]);

      // A second organization's in-window action never appears.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestCorrectiveAction(tx, otherOrgId, {
        dueDate: "2026-02-10",
      });
      expect(windowed.map((row) => row.id)).not.toContain(other.id);
    });
  });

  it("updates a corrective action through its lifecycle and its links", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId);
      const action = await createTestCorrectiveAction(tx, orgId, { status: "open" });

      const attached = await updateCorrectiveAction(tx, {
        organizationId: orgId,
        correctiveActionId: action.id,
        incidentId: incident.id,
        status: "in_progress",
      });
      expect(attached?.incidentId).toBe(incident.id);
      expect(attached?.status).toBe("in_progress");

      const verified = await updateCorrectiveAction(tx, {
        organizationId: orgId,
        correctiveActionId: action.id,
        status: "verified",
        completedAt: at("2026-05-01T09:00:00.000Z"),
        verifiedBy: "00000000-0000-0000-0000-0000000000aa",
        verifiedAt: at("2026-05-02T09:00:00.000Z"),
        incidentId: null,
      });
      expect(verified?.status).toBe("verified");
      expect(verified?.completedAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
      expect(verified?.verifiedAt?.toISOString()).toBe("2026-05-02T09:00:00.000Z");
      expect(verified?.incidentId).toBeNull();
    });
  });

  it("rejects a corrective action status outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestCorrectiveAction(tx, orgId, { status: "cancelled" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/corrective_action_status_check/);
    });
  });

  it("rejects a corrective action whose incident is in another organization (0040)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherIncident = await createTestHmsIncident(tx, otherOrgId, otherLocationId);
      const cause = await rejectionCause(
        createTestCorrectiveAction(tx, orgId, { incidentId: otherIncident.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/corrective_action\.incident_id/);
    });
  });

  it("rejects a corrective action whose reading is in another organization (0040)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherPoint = await createTestMonitoringPoint(tx, otherOrgId, otherLocationId);
      const otherReading = await recordMonitoringReading(tx, {
        organizationId: otherOrgId,
        monitoringPointId: otherPoint.id,
        value: "1",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });
      const cause = await rejectionCause(
        createTestCorrectiveAction(tx, orgId, { monitoringReadingId: otherReading.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/corrective_action\.monitoring_reading_id/);
    });
  });

  it("is not append-only: an incident and an action can be updated and deleted", async () => {
    await inRollback(client.db, async (tx) => {
      const incident = await createTestHmsIncident(tx, orgId, locationId);
      const action = await createTestCorrectiveAction(tx, orgId, { incidentId: incident.id });
      // `DEC-095` records that neither table has an append-only trigger, so a
      // plain DELETE succeeds (inside the rollback). The action goes first
      // because its `incident_id` FK would otherwise block the incident delete.
      await tx.delete(correctiveAction).where(eq(correctiveAction.id, action.id));
      await tx.delete(hmsIncident).where(eq(hmsIncident.id, incident.id));
    });
  });
});
