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

import { findMonitoringPoint } from "./find-monitoring-point";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import { createPostgresHmsStore } from "./postgres-store";
import { recordMonitoringReading } from "./record-monitoring-reading";
import { registerMonitoringPoint } from "./register-monitoring-point";
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
});
