import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  createDb,
  employee,
  listAuditEventsForEntity,
  location,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignShift } from "./assign-shift";
import { completeShift } from "./complete-shift";
import { createShift } from "./create-shift";
import { findShift } from "./find-shift";
import { listShiftAssignments } from "./list-shift-assignments";
import { listShifts } from "./list-shifts";
import { createPostgresSchedulingStore } from "./postgres-store";
import { publishShift } from "./publish-shift";
import { updateShift } from "./update-shift";
import { withdrawShiftAssignment } from "./withdraw-shift-assignment";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const STARTS = "2026-07-01T08:00:00.000Z";
const ENDS = "2026-07-01T16:00:00.000Z";

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
    .values({ organizationId: orgId, code, name: "Scheduling IT location" })
    .returning();
  return rows[0]!.id;
}

async function seedEmployee(
  tx: DatabaseTransaction,
  orgId: string,
  primaryLocationId: string | null,
): Promise<string> {
  const rows = await tx
    .insert(employee)
    .values({
      organizationId: orgId,
      name: "Nora Nordmann",
      roleCode: "barista",
      employmentType: "part_time",
      baseHourlyRate: "215.5000",
      primaryLocationId,
      activeFrom: "2026-01-01",
    })
    .returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("scheduling against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Scheduling IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every shift, assignment, employee and location is created inside a
      // rolled-back transaction, so only the organization is committed.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("runs the plan → update → publish → assign → withdraw → complete lifecycle", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_${suffix}`);
      const employeeId = await seedEmployee(tx, orgId, locationId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        roleCode: "barista",
        startsAt: STARTS,
        endsAt: ENDS,
        breakMinutes: 30,
      });
      expect(shift).toMatchObject({
        organizationId: orgId,
        locationId,
        roleCode: "barista",
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T16:00:00.000Z",
        breakMinutes: 30,
        state: "open",
        publishedAt: null,
      });

      const updated = await updateShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
        endsAt: "2026-07-01T17:00:00.000Z",
        breakMinutes: 45,
      });
      expect(updated).toMatchObject({
        endsAt: "2026-07-01T17:00:00.000Z",
        breakMinutes: 45,
      });
      expect(updated?.updatedAt).not.toBeNull();

      const published = await publishShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
      });
      expect(published.state).toBe("published");
      expect(published.publishedAt).not.toBeNull();

      const assignment = await assignShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
        employeeId,
      });
      expect(assignment).toMatchObject({
        shiftId: shift.id,
        employeeId,
        state: "approved",
        assignedBy: actorId,
      });
      expect((await findShift(store, { organizationId: orgId, shiftId: shift.id }))?.state).toBe(
        "assigned",
      );

      const withdrawn = await withdrawShiftAssignment(store, {
        organizationId: orgId,
        actorId,
        shiftAssignmentId: assignment.id,
      });
      expect(withdrawn.state).toBe("withdrawn");
      expect((await findShift(store, { organizationId: orgId, shiftId: shift.id }))?.state).toBe(
        "published",
      );

      const completed = await completeShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
      });
      expect(completed.state).toBe("completed");

      const shiftAudit = (await listAuditEventsForEntity(tx, "shift", shift.id)).map(
        (row) => row.action,
      );
      expect(shiftAudit).toEqual(
        expect.arrayContaining([
          "workforce.shift.created",
          "workforce.shift.updated",
          "workforce.shift.published",
          "workforce.shift.completed",
        ]),
      );
      const assignmentAudit = (
        await listAuditEventsForEntity(tx, "shift_assignment", assignment.id)
      ).map((row) => row.action);
      expect(assignmentAudit).toEqual(
        expect.arrayContaining([
          "workforce.shift_assignment.created",
          "workforce.shift_assignment.withdrawn",
        ]),
      );
    });
  });

  it("fails closed on the assignment location rule and rejects a duplicate", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_a_${suffix}`);
      const otherLocationId = await seedLocation(tx, orgId, `sch_b_${suffix}`);
      const noLocationEmployee = await seedEmployee(tx, orgId, null);
      const elsewhereEmployee = await seedEmployee(tx, orgId, otherLocationId);
      const employeeId = await seedEmployee(tx, orgId, locationId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: STARTS,
        endsAt: ENDS,
      });

      await expect(
        assignShift(store, {
          organizationId: orgId,
          actorId,
          shiftId: shift.id,
          employeeId: noLocationEmployee,
        }),
      ).rejects.toThrow(
        new DomainError("employee must have a primary location matching the shift location"),
      );
      await expect(
        assignShift(store, {
          organizationId: orgId,
          actorId,
          shiftId: shift.id,
          employeeId: elsewhereEmployee,
        }),
      ).rejects.toThrow(/primary location matching the shift location/);

      const assignment = await assignShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
        employeeId,
      });
      await withdrawShiftAssignment(store, {
        organizationId: orgId,
        actorId,
        shiftAssignmentId: assignment.id,
      });
      await expect(
        assignShift(store, { organizationId: orgId, actorId, shiftId: shift.id, employeeId }),
      ).rejects.toThrow(/already assigned/);
    });
  });

  it("is organization-scoped for reads and state transitions", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_c_${suffix}`);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();
      const otherOrgId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: STARTS,
        endsAt: ENDS,
      });

      expect(
        await findShift(store, { organizationId: otherOrgId, shiftId: shift.id }),
      ).toBeUndefined();
      expect(await listShifts(store, { organizationId: otherOrgId })).toEqual([]);
      await expect(
        publishShift(store, { organizationId: otherOrgId, actorId, shiftId: shift.id }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("orders, filters and pages shifts and assignments", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_d_${suffix}`);
      const employeeId = await seedEmployee(tx, orgId, locationId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const late = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: "2026-07-02T08:00:00.000Z",
        endsAt: "2026-07-02T16:00:00.000Z",
      });
      const early = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T16:00:00.000Z",
      });
      await publishShift(store, { organizationId: orgId, actorId, shiftId: early.id });
      const assignment = await assignShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: early.id,
        employeeId,
      });

      const ordered = await listShifts(store, { organizationId: orgId });
      expect(ordered.map((row) => row.id)).toEqual([early.id, late.id]);

      const published = await listShifts(store, { organizationId: orgId, state: "published" });
      expect(published).toEqual([]);
      const assigned = await listShifts(store, { organizationId: orgId, state: "assigned" });
      expect(assigned.map((row) => row.id)).toEqual([early.id]);

      const window = await listShifts(store, {
        organizationId: orgId,
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-01T23:59:59.000Z",
      });
      expect(window.map((row) => row.id)).toEqual([early.id]);

      const page = await listShifts(store, { organizationId: orgId, limit: 1, offset: 1 });
      expect(page.map((row) => row.id)).toEqual([late.id]);

      const assignments = await listShiftAssignments(store, {
        organizationId: orgId,
        shiftId: early.id,
        employeeId,
        state: "approved",
      });
      expect(assignments.map((row) => row.id)).toEqual([assignment.id]);
      expect(
        await listShiftAssignments(store, { organizationId: orgId, state: "withdrawn" }),
      ).toEqual([]);
    });
  });

  it("rejects amending a terminal shift", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_e_${suffix}`);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: STARTS,
        endsAt: ENDS,
      });
      await publishShift(store, { organizationId: orgId, actorId, shiftId: shift.id });
      await completeShift(store, { organizationId: orgId, actorId, shiftId: shift.id });

      await expect(
        updateShift(store, { organizationId: orgId, actorId, shiftId: shift.id, breakMinutes: 5 }),
      ).rejects.toThrow(/cannot be updated/);
    });
  });
});
