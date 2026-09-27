import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  createDb,
  employee,
  listAuditEventsForEntity,
  location,
  sql,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignShift } from "./assign-shift";
import { completeShift } from "./complete-shift";
import { computeWorkedHours } from "./compute-worked-hours";
import { createShift } from "./create-shift";
import { createShiftAdjustment } from "./create-shift-adjustment";
import { decideSelfAssignment } from "./decide-self-assignment";
import { findPayrollReport } from "./find-payroll-report";
import { findShift } from "./find-shift";
import { findShiftAdjustment } from "./find-shift-adjustment";
import { generatePayrollReport } from "./generate-payroll-report";
import { listMyShifts } from "./list-my-shifts";
import { listPayrollReports } from "./list-payroll-reports";
import { listShiftAdjustments } from "./list-shift-adjustments";
import { listShiftAssignments } from "./list-shift-assignments";
import { listShifts } from "./list-shifts";
import { markPayrollReportExported } from "./mark-payroll-report-exported";
import { createPostgresSchedulingStore } from "./postgres-store";
import { publishShift } from "./publish-shift";
import { selfAssignShift } from "./self-assign-shift";
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
  userId: string | null = null,
): Promise<string> {
  const rows = await tx
    .insert(employee)
    .values({
      organizationId: orgId,
      userId,
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

/** Seeds one `app_user` so an `employee.user_id` FK link can point at it. */
async function seedUser(tx: DatabaseTransaction, orgId: string, username: string): Promise<string> {
  // Raw SQL on the stable base columns: the invite slice (`DEC-146`) is adding
  // `invited_at`/`invited_by` to `app_user` in parallel, and those columns may
  // not be migrated in a given database yet. Only `id` is read back.
  const result = (await tx.execute(
    sql`insert into "app_user" ("organization_id", "display_name", "username", "password_hash")
        values (${orgId}, ${"Self Assigner"}, ${username}, ${"not-a-real-hash"})
        returning "id"`,
  )) as unknown as { readonly rows: readonly { readonly id: string }[] };
  return result.rows[0]!.id;
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

  it("records a worked-hours correction and computes hours per employee", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_f_${suffix}`);
      const employeeId = await seedEmployee(tx, orgId, locationId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: STARTS,
        endsAt: ENDS,
        breakMinutes: 30,
      });
      await publishShift(store, { organizationId: orgId, actorId, shiftId: shift.id });
      const assignment = await assignShift(store, {
        organizationId: orgId,
        actorId,
        shiftId: shift.id,
        employeeId,
      });

      const adjustment = await createShiftAdjustment(store, {
        organizationId: orgId,
        actorId,
        shiftAssignmentId: assignment.id,
        adjustedHours: "6.5",
        reason: "early departure",
      });
      expect(adjustment).toMatchObject({
        shiftAssignmentId: assignment.id,
        adjustedHours: "6.50",
        reason: "early departure",
        approvedBy: actorId,
      });
      expect(adjustment.approvedAt).not.toBeNull();

      expect(
        await findShiftAdjustment(store, {
          organizationId: orgId,
          shiftAdjustmentId: adjustment.id,
        }),
      ).toMatchObject({ id: adjustment.id });
      expect(
        await findShiftAdjustment(store, {
          organizationId: randomUUID(),
          shiftAdjustmentId: adjustment.id,
        }),
      ).toBeUndefined();
      expect(
        (
          await listShiftAdjustments(store, {
            organizationId: orgId,
            shiftAssignmentId: assignment.id,
          })
        ).map((row) => row.id),
      ).toEqual([adjustment.id]);

      const from = "2026-07-01T00:00:00.000Z";
      const to = "2026-07-02T00:00:00.000Z";
      const result = await computeWorkedHours(store, { organizationId: orgId, from, to });
      expect(result.rows).toEqual([
        {
          employeeId,
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "6.50",
          hourlyRate: "215.5000",
        },
      ]);
      expect(result.totalHours).toBe("6.50");

      // A location filter that matches nothing yields an empty, zero-total result.
      const elsewhere = await computeWorkedHours(store, {
        organizationId: orgId,
        from,
        to,
        locationId: randomUUID(),
      });
      expect(elsewhere.rows).toEqual([]);
      expect(elsewhere.totalHours).toBe("0.00");
      // Another organization sees nothing.
      expect(
        (await computeWorkedHours(store, { organizationId: randomUUID(), from, to })).rows,
      ).toEqual([]);

      const audit = (await listAuditEventsForEntity(tx, "shift_adjustment", adjustment.id)).map(
        (row) => row.action,
      );
      expect(audit).toEqual(["workforce.shift_adjustment.created"]);
    });
  });

  it("rejects a correction on a withdrawn assignment, a bad decimal and a missing assignment", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_g_${suffix}`);
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
      await publishShift(store, { organizationId: orgId, actorId, shiftId: shift.id });
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
        createShiftAdjustment(store, {
          organizationId: orgId,
          actorId,
          shiftAssignmentId: assignment.id,
          adjustedHours: "6",
          reason: "x",
        }),
      ).rejects.toThrow(/cannot be adjusted/);
      await expect(
        createShiftAdjustment(store, {
          organizationId: orgId,
          actorId,
          shiftAssignmentId: assignment.id,
          adjustedHours: "6.123",
          reason: "x",
        }),
      ).rejects.toThrow(/more than 2 decimal places/);
      await expect(
        createShiftAdjustment(store, {
          organizationId: orgId,
          actorId,
          shiftAssignmentId: randomUUID(),
          adjustedHours: "6",
          reason: "x",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("generates, supersedes, exports and org-scopes the monthly payroll report", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `sch_pr_${suffix}`);
      const employeeId = await seedEmployee(tx, orgId, locationId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        startsAt: STARTS,
        endsAt: ENDS,
        breakMinutes: 30,
      });
      await publishShift(store, { organizationId: orgId, actorId, shiftId: shift.id });
      await assignShift(store, { organizationId: orgId, actorId, shiftId: shift.id, employeeId });

      const report = await generatePayrollReport(store, {
        organizationId: orgId,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        actorId,
      });
      expect(report).toMatchObject({
        organizationId: orgId,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "generated",
        generatedBy: actorId,
        exportFileId: null,
      });
      // 8 h shift (16:00 − 08:00) minus a 30-minute break = 7.50 h;
      // 7.50 × 215.5000 = 1616.2500.
      expect(report.snapshot).toMatchObject({
        currency: "NOK",
        lines: [
          {
            employeeId,
            employeeName: "Nora Nordmann",
            roleCode: "barista",
            hours: "7.50",
            hourlyRate: "215.5000",
            expectedPay: "1616.2500",
          },
        ],
        totalHours: "7.50",
        totalExpectedPay: "1616.2500",
      });

      expect(
        await findPayrollReport(store, { organizationId: orgId, payrollReportId: report.id }),
      ).toMatchObject({ id: report.id });
      expect(
        await findPayrollReport(store, {
          organizationId: randomUUID(),
          payrollReportId: report.id,
        }),
      ).toBeUndefined();
      expect(await listPayrollReports(store, { organizationId: randomUUID() })).toEqual([]);

      const regenerated = await generatePayrollReport(store, {
        organizationId: orgId,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        actorId,
      });
      expect(regenerated.id).not.toBe(report.id);
      expect(
        await findPayrollReport(store, { organizationId: orgId, payrollReportId: report.id }),
      ).toMatchObject({ status: "superseded" });

      const live = await listPayrollReports(store, { organizationId: orgId, status: "generated" });
      expect(live.map((row) => row.id)).toEqual([regenerated.id]);

      await expect(
        markPayrollReportExported(store, {
          organizationId: orgId,
          payrollReportId: report.id,
          actorId,
        }),
      ).rejects.toThrow(/cannot be exported/);
      await expect(
        markPayrollReportExported(store, {
          organizationId: randomUUID(),
          payrollReportId: regenerated.id,
          actorId,
        }),
      ).rejects.toThrow(NotFoundError);

      const exported = await markPayrollReportExported(store, {
        organizationId: orgId,
        payrollReportId: regenerated.id,
        actorId,
      });
      expect(exported).toMatchObject({ status: "exported" });

      const audit = (await listAuditEventsForEntity(tx, "payroll_report", regenerated.id)).map(
        (row) => row.action,
      );
      expect(audit).toEqual([
        "workforce.payroll_report.generated",
        "workforce.payroll_report.exported",
      ]);
    });
  });

  it("self-assigns pending and a manager approves it against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `self_approve_${suffix}`);
      const userId = await seedUser(tx, orgId, `self_approve_${suffix}`);
      const employeeId = await seedEmployee(tx, orgId, locationId, userId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        roleCode: "barista",
        startsAt: STARTS,
        endsAt: ENDS,
      });

      const pending = await selfAssignShift(store, {
        organizationId: orgId,
        actorUserId: userId,
        shiftId: shift.id,
      });
      expect(pending).toMatchObject({
        organizationId: orgId,
        shiftId: shift.id,
        employeeId,
        state: "pending_approval",
        assignedBy: null,
      });
      expect(await findShift(store, { organizationId: orgId, shiftId: shift.id })).toMatchObject({
        state: "open",
      });

      const managerId = randomUUID();
      const approved = await decideSelfAssignment(store, {
        organizationId: orgId,
        actorId: managerId,
        assignmentId: pending.id,
        decision: "approved",
      });
      expect(approved).toMatchObject({ state: "approved", assignedBy: managerId });
      expect(await findShift(store, { organizationId: orgId, shiftId: shift.id })).toMatchObject({
        state: "assigned",
      });

      const audit = (await listAuditEventsForEntity(tx, "shift_assignment", pending.id)).map(
        (row) => row.action,
      );
      expect(audit).toEqual([
        "workforce.shift_assignment.self_requested",
        "workforce.shift_assignment.approved",
      ]);
    });
  });

  it("rejects a pending self-assignment and leaves the shift open against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `self_reject_${suffix}`);
      const userId = await seedUser(tx, orgId, `self_reject_${suffix}`);
      await seedEmployee(tx, orgId, locationId, userId);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        roleCode: "barista",
        startsAt: STARTS,
        endsAt: ENDS,
      });
      const pending = await selfAssignShift(store, {
        organizationId: orgId,
        actorUserId: userId,
        shiftId: shift.id,
      });

      const rejected = await decideSelfAssignment(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        assignmentId: pending.id,
        decision: "rejected",
        reason: "Already covered by the rota",
      });
      expect(rejected).toMatchObject({ state: "rejected", assignedBy: null });
      expect(await findShift(store, { organizationId: orgId, shiftId: shift.id })).toMatchObject({
        state: "open",
      });

      // A rejection without a reason is refused.
      const second = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        roleCode: "barista",
        startsAt: STARTS,
        endsAt: ENDS,
      });
      const secondPending = await selfAssignShift(store, {
        organizationId: orgId,
        actorUserId: userId,
        shiftId: second.id,
      });
      await expect(
        decideSelfAssignment(store, {
          organizationId: orgId,
          actorId,
          assignmentId: secondPending.id,
          decision: "rejected",
        }),
      ).rejects.toThrow(/reason is required/);
    });
  });

  it("fails closed when the account has no employee link against PostgreSQL", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `self_nolink_${suffix}`);
      const userId = await seedUser(tx, orgId, `self_nolink_${suffix}`);
      const store = createPostgresSchedulingStore(tx);
      const actorId = randomUUID();

      const shift = await createShift(store, {
        organizationId: orgId,
        actorId,
        locationId,
        roleCode: "barista",
        startsAt: STARTS,
        endsAt: ENDS,
      });

      await expect(
        selfAssignShift(store, { organizationId: orgId, actorUserId: userId, shiftId: shift.id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        listMyShifts(store, { organizationId: orgId, actorUserId: userId }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
