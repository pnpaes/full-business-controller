import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { location, monitoringReading, organization } from "../schema";
import {
  createMonitoringPoint,
  findMonitoringPoint,
  listMonitoringPoints,
  listMonitoringReadings,
  recordMonitoringReading,
} from "./monitoring";
import {
  createTestLocation,
  createTestMonitoringPoint,
  createTestOrganization,
  createTestStorageArea,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("monitoring repository", () => {
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
      // Every point and reading is created inside a rolled-back transaction, so
      // the committed fixtures to unwind are the location and the organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a monitoring point and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createMonitoringPoint(tx, {
        organizationId: orgId,
        locationId,
        code: uniqueName("fridge"),
        name: "Walk-in fridge",
        kind: "refrigerator",
        unit: "celsius",
        targetMin: "0",
        targetMax: "4",
        checkFrequency: "twice_daily",
      });
      expect(created.name).toBe("Walk-in fridge");
      expect(created.kind).toBe("refrigerator");
      expect(created.unit).toBe("celsius");
      expect(created.checkFrequency).toBe("twice_daily");
      expect(created.active).toBe(true);
      expect(created.storageAreaId).toBeNull();
      expect(Number(created.targetMin)).toBe(0);
      expect(Number(created.targetMax)).toBe(4);

      expect(
        (await findMonitoringPoint(tx, { organizationId: orgId, monitoringPointId: created.id }))
          ?.id,
      ).toBe(created.id);

      // A point in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findMonitoringPoint(tx, {
          organizationId: otherOrgId,
          monitoringPointId: created.id,
        }),
      ).toBeUndefined();
    });
  });

  it("lists by location and active-only with paging and second-org isolation", async () => {
    await inRollback(client.db, async (tx) => {
      const otherLocation = await createTestLocation(tx, orgId);
      const a = await createTestMonitoringPoint(tx, orgId, locationId, { code: "a-fridge" });
      const b = await createTestMonitoringPoint(tx, orgId, locationId, {
        code: "b-freezer",
        active: false,
      });
      const c = await createTestMonitoringPoint(tx, orgId, otherLocation.id, { code: "c-fridge" });

      const all = await listMonitoringPoints(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const here = await listMonitoringPoints(tx, { organizationId: orgId, locationId });
      expect(here.map((row) => row.id)).toEqual([a.id, b.id]);

      const active = await listMonitoringPoints(tx, { organizationId: orgId, activeOnly: true });
      expect(active.map((row) => row.id)).toEqual([a.id, c.id]);

      const paged = await listMonitoringPoints(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const other = await createTestMonitoringPoint(tx, otherOrgId, otherLocationId);
      expect(
        (await listMonitoringPoints(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("rejects a duplicate (organization_id, code)", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("fridge");
      await createTestMonitoringPoint(tx, orgId, locationId, { code });
      const cause = await rejectionCause(
        createTestMonitoringPoint(tx, orgId, locationId, { code }),
      );
      expect(cause.message).toMatch(/monitoring_point_organization_id_code_key/);
    });
  });

  it("rejects an inverted target range (target_min > target_max)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestMonitoringPoint(tx, orgId, locationId, { targetMin: "5", targetMax: "0" }),
      );
      expect(cause.message).toMatch(/monitoring_point_target_range_check/);
    });
  });

  it("accepts a same-organization location and storage area (0039)", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const point = await createTestMonitoringPoint(tx, orgId, locationId, {
        storageAreaId: area.id,
      });
      expect(point.locationId).toBe(locationId);
      expect(point.storageAreaId).toBe(area.id);
    });
  });

  it("rejects a monitoring point whose location is in another organization (0039)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id is a valid `location` row (the single-column FK passes), but the
      // organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(createTestMonitoringPoint(tx, orgId, otherLocation.id));
      expect((cause as { code?: string }).code).toBe("23514");
      expect(cause.message).toMatch(/monitoring_point\.location_id/);
    });
  });

  it("rejects a monitoring point whose storage area is in another organization (0039)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherArea = await createTestStorageArea(tx, otherOrgId, otherLocation.id);
      const cause = await rejectionCause(
        createTestMonitoringPoint(tx, orgId, locationId, { storageAreaId: otherArea.id }),
      );
      expect((cause as { code?: string }).code).toBe("23514");
      expect(cause.message).toMatch(/monitoring_point\.storage_area_id/);
    });
  });

  it("rejects a monitoring reading whose point is in another organization (0039)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherPoint = await createTestMonitoringPoint(tx, otherOrgId, otherLocation.id);
      const cause = await rejectionCause(
        recordMonitoringReading(tx, {
          organizationId: orgId,
          monitoringPointId: otherPoint.id,
          value: "2",
          unit: "celsius",
          measuredAt: at("2026-01-01T08:00:00.000Z"),
          recordedBy: null,
          inRange: true,
        }),
      );
      expect((cause as { code?: string }).code).toBe("23514");
      expect(cause.message).toMatch(/monitoring_reading\.monitoring_point_id/);
    });
  });

  it("records readings and lists them newest first, organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const point = await createTestMonitoringPoint(tx, orgId, locationId);
      const january = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "2.5",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });
      const march = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "9.5",
        unit: "celsius",
        measuredAt: at("2026-03-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: false,
        notes: "door left open",
      });
      expect(Number(march.value)).toBe(9.5);
      expect(march.inRange).toBe(false);
      expect(march.notes).toBe("door left open");

      const listed = await listMonitoringReadings(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
      });
      expect(listed.map((row) => row.id)).toEqual([march.id, january.id]);

      const paged = await listMonitoringReadings(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([january.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherPoint = await createTestMonitoringPoint(tx, otherOrgId, otherLocationId);
      await recordMonitoringReading(tx, {
        organizationId: otherOrgId,
        monitoringPointId: otherPoint.id,
        value: "1",
        unit: "celsius",
        measuredAt: at("2026-02-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });
      expect(
        (await listMonitoringReadings(tx, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([march.id, january.id]);
    });
  });

  it("rejects updating an immutable reading field (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const point = await createTestMonitoringPoint(tx, orgId, locationId);
      const reading = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "3",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });

      const cause = await rejectionCause(
        (async () => {
          await tx
            .update(monitoringReading)
            .set({ value: "9" })
            .where(eq(monitoringReading.id, reading.id));
        })(),
      );
      expect(cause.message).toMatch(/monitoring_reading is append-only/);
    });
  });

  it("rejects deleting a reading (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const point = await createTestMonitoringPoint(tx, orgId, locationId);
      const reading = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "3",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });

      const cause = await rejectionCause(
        (async () => {
          await tx.delete(monitoringReading).where(eq(monitoringReading.id, reading.id));
        })(),
      );
      expect(cause.message).toMatch(/DELETE is not permitted/);
    });
  });

  it("allows amending only the reading notes", async () => {
    await inRollback(client.db, async (tx) => {
      const point = await createTestMonitoringPoint(tx, orgId, locationId);
      const reading = await recordMonitoringReading(tx, {
        organizationId: orgId,
        monitoringPointId: point.id,
        value: "3",
        unit: "celsius",
        measuredAt: at("2026-01-01T08:00:00.000Z"),
        recordedBy: null,
        inRange: true,
      });

      const updated = await tx
        .update(monitoringReading)
        .set({ notes: "checked by the night shift" })
        .where(eq(monitoringReading.id, reading.id))
        .returning();
      expect(updated[0]?.notes).toBe("checked by the night shift");
      expect(Number(updated[0]?.value)).toBe(3);
    });
  });
});
