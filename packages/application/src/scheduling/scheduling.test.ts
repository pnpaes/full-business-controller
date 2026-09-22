import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it, vi } from "vitest";

import { assignShift } from "./assign-shift";
import type { AssignShiftInput } from "./assign-shift";
import { cancelShift } from "./cancel-shift";
import { completeShift } from "./complete-shift";
import { computeWorkedHours } from "./compute-worked-hours";
import { createShift } from "./create-shift";
import type { CreateShiftInput } from "./create-shift";
import { createShiftAdjustment } from "./create-shift-adjustment";
import { findPayrollReport } from "./find-payroll-report";
import { findShift } from "./find-shift";
import { findShiftAdjustment } from "./find-shift-adjustment";
import { findShiftAssignment } from "./find-shift-assignment";
import { generatePayrollReport } from "./generate-payroll-report";
import type { GeneratePayrollReportInput } from "./generate-payroll-report";
import { DEFAULT_PAYROLL_REPORT_LIMIT, listPayrollReports } from "./list-payroll-reports";
import { markPayrollReportExported } from "./mark-payroll-report-exported";
import { DEFAULT_SHIFT_ADJUSTMENT_LIMIT, listShiftAdjustments } from "./list-shift-adjustments";
import { DEFAULT_SHIFT_ASSIGNMENT_LIMIT, listShiftAssignments } from "./list-shift-assignments";
import { DEFAULT_SHIFT_LIMIT, listShifts } from "./list-shifts";
import { publishShift } from "./publish-shift";
import {
  FakeSchedulingStore,
  seedSchedulingEmployee,
  seedSchedulingFixture,
  type SchedulingFixture,
} from "./test-support";
import { SHIFT_ASSIGNMENT_STATES, SHIFT_STATES } from "./types";
import { updateShift } from "./update-shift";
import { withdrawShiftAssignment } from "./withdraw-shift-assignment";

const STARTS = "2026-07-01T08:00:00.000Z";
const ENDS = "2026-07-01T16:00:00.000Z";

function setup(): { store: FakeSchedulingStore; fixture: SchedulingFixture } {
  const store = new FakeSchedulingStore();
  const fixture = seedSchedulingFixture();
  seedSchedulingEmployee(store, {
    id: fixture.employeeId,
    organizationId: fixture.organizationId,
    primaryLocationId: fixture.locationId,
    roleCode: "barista",
  });
  seedSchedulingEmployee(store, {
    id: fixture.otherEmployeeId,
    organizationId: fixture.otherOrganizationId,
    primaryLocationId: fixture.otherLocationId,
    roleCode: "barista",
  });
  return { store, fixture };
}

function plan(
  store: FakeSchedulingStore,
  fixture: SchedulingFixture,
  overrides: Partial<CreateShiftInput> = {},
) {
  return createShift(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    locationId: fixture.locationId,
    startsAt: STARTS,
    endsAt: ENDS,
    ...overrides,
  });
}

function assign(
  store: FakeSchedulingStore,
  fixture: SchedulingFixture,
  shiftId: string,
  overrides: Partial<AssignShiftInput> = {},
) {
  return assignShift(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    shiftId,
    employeeId: fixture.employeeId,
    ...overrides,
  });
}

describe("scheduling vocabularies", () => {
  it("mirrors the persistence state enums", () => {
    expect(SHIFT_STATES).toEqual(["open", "published", "assigned", "cancelled", "completed"]);
    expect(SHIFT_ASSIGNMENT_STATES).toEqual([
      "self_assigned",
      "pending_approval",
      "approved",
      "withdrawn",
      "rejected",
    ]);
  });
});

describe("createShift", () => {
  it("plans an open shift with its audit fact", async () => {
    const { store, fixture } = setup();

    const shift = await plan(store, fixture, { roleCode: "  barista  ", breakMinutes: 30 });

    expect(shift).toMatchObject({
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      roleCode: "barista",
      startsAt: STARTS,
      endsAt: ENDS,
      breakMinutes: 30,
      state: "open",
      publishedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: null,
    });
    expect(store.shifts.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "workforce.shift.created");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "shift",
      entityId: shift.id,
      after: {
        location_id: fixture.locationId,
        role_code: "barista",
        starts_at: STARTS,
        ends_at: ENDS,
        break_minutes: 30,
        state: "open",
      },
    });
  });

  it("defaults the break to 0 and a blank role to null", async () => {
    const { store, fixture } = setup();

    const shift = await plan(store, fixture, { roleCode: "   " });

    expect(shift.breakMinutes).toBe(0);
    expect(shift.roleCode).toBeNull();
  });

  it("rejects a missing location", async () => {
    const { store, fixture } = setup();

    await expect(plan(store, fixture, { locationId: "  " })).rejects.toThrow(
      new DomainError("locationId is required"),
    );
  });

  it("rejects an instant without seconds", async () => {
    const { store, fixture } = setup();

    await expect(plan(store, fixture, { startsAt: "2026-07-01T08:00Z" })).rejects.toThrow(
      /startsAt must be an ISO-8601 instant/,
    );
    await expect(plan(store, fixture, { endsAt: "2026-07-01" })).rejects.toThrow(
      /endsAt must be an ISO-8601 instant/,
    );
  });

  it("rejects a window that does not advance", async () => {
    const { store, fixture } = setup();

    await expect(plan(store, fixture, { endsAt: STARTS })).rejects.toThrow(
      new DomainError("endsAt must be after startsAt"),
    );
  });

  it("rejects a negative, fractional or non-numeric break", async () => {
    const { store, fixture } = setup();

    await expect(plan(store, fixture, { breakMinutes: -1 })).rejects.toThrow(
      /breakMinutes must be a non-negative integer/,
    );
    await expect(plan(store, fixture, { breakMinutes: 1.5 })).rejects.toThrow(
      /breakMinutes must be a non-negative integer/,
    );
    await expect(plan(store, fixture, { breakMinutes: "30" as unknown as number })).rejects.toThrow(
      /breakMinutes must be a non-negative integer/,
    );
  });

  it("rolls the shift back when its audit fact cannot be written", async () => {
    const { store, fixture } = setup();
    vi.spyOn(store, "writeAudit").mockRejectedValueOnce(new Error("audit down"));

    await expect(plan(store, fixture)).rejects.toThrow("audit down");

    expect(store.shifts.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("updateShift", () => {
  it("amends the window, break and role with a before/after audit fact", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture, { breakMinutes: 0 });

    const updated = await updateShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
      endsAt: "2026-07-01T17:00:00.000Z",
      breakMinutes: 45,
      roleCode: "cook",
    });

    expect(updated).toMatchObject({
      startsAt: STARTS,
      endsAt: "2026-07-01T17:00:00.000Z",
      breakMinutes: 45,
      roleCode: "cook",
    });
    expect(updated.updatedAt).not.toBeNull();

    const audit = store.audits.find((row) => row.action === "workforce.shift.updated");
    expect(audit?.before).toEqual({ ends_at: ENDS, break_minutes: 0, role_code: null });
    expect(audit?.after).toEqual({
      ends_at: "2026-07-01T17:00:00.000Z",
      break_minutes: 45,
      role_code: "cook",
    });
  });

  it("clears the role with a blank value", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture, { roleCode: "barista" });

    const updated = await updateShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
      roleCode: "  ",
    });

    expect(updated.roleCode).toBeNull();
  });

  it("rejects an empty patch", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    await expect(
      updateShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      }),
    ).rejects.toThrow(new DomainError("no updatable fields provided"));
  });

  it("rejects a partial patch that inverts the window", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    await expect(
      updateShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
        startsAt: "2026-07-01T18:00:00.000Z",
      }),
    ).rejects.toThrow(new DomainError("endsAt must be after startsAt"));
  });

  it("is a typed not-found for an unknown or cross-organization shift", async () => {
    const { store, fixture } = setup();

    await expect(
      updateShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: "nope",
        breakMinutes: 5,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects amending a terminal (completed or cancelled) shift", async () => {
    const { store, fixture } = setup();
    const completed = await plan(store, fixture);
    await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: completed.id,
    });
    await completeShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: completed.id,
    });
    const cancelled = await plan(store, fixture);
    await cancelShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: cancelled.id,
    });

    for (const shiftId of [completed.id, cancelled.id]) {
      await expect(
        updateShift(store, {
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          shiftId,
          breakMinutes: 10,
        }),
      ).rejects.toThrow(/cannot be updated/);
    }
  });

  it("locks the shift before checking its state", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const lock = vi.spyOn(store, "lockShift");

    await updateShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
      breakMinutes: 5,
    });

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: fixture.organizationId, shiftId: shift.id }),
    );
  });
});

describe("publishShift", () => {
  it("moves an open shift to published and stamps the instant", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    const published = await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
    });

    expect(published.state).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const audit = store.audits.find((row) => row.action === "workforce.shift.published");
    expect(audit?.before).toEqual({ state: "open", published_at: null });
    expect(audit?.after).toMatchObject({ state: "published" });
  });

  it("rejects publishing anything other than an open shift", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const publish = () =>
      publishShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      });
    await publish();

    await expect(publish()).rejects.toThrow(/cannot be published/);
  });

  it("is a typed not-found for a missing or cross-organization shift", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    await expect(
      publishShift(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("cancelShift", () => {
  it("cancels a live shift with its audit fact", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    const cancelled = await cancelShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
    });

    expect(cancelled.state).toBe("cancelled");
    expect(store.audits.find((row) => row.action === "workforce.shift.cancelled")?.after).toEqual({
      state: "cancelled",
    });
  });

  it("rejects cancelling a terminal shift", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const cancel = () =>
      cancelShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      });
    await cancel();

    await expect(cancel()).rejects.toThrow(/cannot be cancelled/);
  });

  it("is a typed not-found for a missing shift", async () => {
    const { store, fixture } = setup();

    await expect(
      cancelShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: "nope",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to cancel an assigned shift until the assignment is withdrawn", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await expect(
      cancelShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      }),
    ).rejects.toThrow(new DomainError("withdraw the assignment before cancelling the shift"));
    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "assigned" });

    await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    await expect(
      cancelShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: shift.id,
      }),
    ).resolves.toMatchObject({ state: "cancelled" });
  });
});

describe("completeShift", () => {
  it("completes a published and an assigned shift", async () => {
    const { store, fixture } = setup();
    const published = await plan(store, fixture);
    await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: published.id,
    });
    const assigned = await plan(store, fixture);
    await assign(store, fixture, assigned.id);

    await expect(
      completeShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: published.id,
      }),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(
      completeShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: assigned.id,
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("rejects completing an open or cancelled shift", async () => {
    const { store, fixture } = setup();
    const open = await plan(store, fixture);
    const cancelled = await plan(store, fixture);
    await cancelShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: cancelled.id,
    });

    await expect(
      completeShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: open.id,
      }),
    ).rejects.toThrow(/cannot be completed/);
    await expect(
      completeShift(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftId: cancelled.id,
      }),
    ).rejects.toThrow(/cannot be completed/);
  });
});

describe("assignShift", () => {
  it("assigns an employee to an open shift and moves the shift to assigned", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    const assignment = await assign(store, fixture, shift.id);

    expect(assignment).toMatchObject({
      organizationId: fixture.organizationId,
      shiftId: shift.id,
      employeeId: fixture.employeeId,
      state: "approved",
      assignedBy: fixture.actorId,
    });
    expect(assignment.assignedAt).toEqual(expect.any(String));
    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "assigned" });

    const audit = store.audits.find((row) => row.action === "workforce.shift_assignment.created");
    expect(audit).toMatchObject({
      entityType: "shift_assignment",
      entityId: assignment.id,
      before: { shift_state: "open" },
      after: {
        shift_id: shift.id,
        employee_id: fixture.employeeId,
        state: "approved",
        assigned_by: fixture.actorId,
        assigned_at: assignment.assignedAt,
        shift_state: "assigned",
      },
    });
  });

  it("assigns to a published shift", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
    });

    const assignment = await assign(store, fixture, shift.id);

    expect(assignment.state).toBe("approved");
    expect(
      store.audits.find((row) => row.action === "workforce.shift_assignment.created")?.before,
    ).toEqual({ shift_state: "published" });
  });

  it("fails closed when the employee has no primary location", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: "employee-no-location",
      organizationId: fixture.organizationId,
      primaryLocationId: null,
      roleCode: "barista",
    });
    const shift = await plan(store, fixture);

    await expect(
      assign(store, fixture, shift.id, { employeeId: "employee-no-location" }),
    ).rejects.toThrow(
      new DomainError("employee must have a primary location matching the shift location"),
    );
  });

  it("rejects an employee whose primary location differs from the shift's", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: "employee-elsewhere",
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.otherLocationId,
      roleCode: "barista",
    });
    const shift = await plan(store, fixture);

    await expect(
      assign(store, fixture, shift.id, { employeeId: "employee-elsewhere" }),
    ).rejects.toThrow(/primary location matching the shift location/);
  });

  it("accepts any employee role when the shift declares no role", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    expect(shift.roleCode).toBeNull();
    await expect(assign(store, fixture, shift.id)).resolves.toMatchObject({ state: "approved" });
  });

  it("rejects an employee whose role differs from the shift's", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture, { roleCode: "cook" });

    await expect(assign(store, fixture, shift.id)).rejects.toThrow(
      new DomainError("the employee's role does not match the shift's role"),
    );
    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "open" });
  });

  it("assigns an employee whose role matches the shift's", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture, { roleCode: "barista" });

    await expect(assign(store, fixture, shift.id)).resolves.toMatchObject({ state: "approved" });
  });

  it("is a typed not-found for a missing or cross-organization employee", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    await expect(assign(store, fixture, shift.id, { employeeId: "nope" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      assign(store, fixture, shift.id, { employeeId: fixture.otherEmployeeId }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects a duplicate assignment for the same shift and employee", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    // Withdrawing returns the shift to `open` while the assignment fact remains,
    // so the duplicate rejection is what fires, not the state guard.
    await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    await expect(assign(store, fixture, shift.id)).rejects.toThrow(
      new DomainError("employee is already assigned to this shift"),
    );
  });

  it("rejects assigning to a shift that is not open or published", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    await assign(store, fixture, shift.id);

    await expect(
      assign(store, fixture, shift.id, { employeeId: fixture.employeeId }),
    ).rejects.toThrow(/cannot take an assignment/);
  });

  it("is a typed not-found for a missing shift", async () => {
    const { store, fixture } = setup();

    await expect(assign(store, fixture, "nope")).rejects.toThrow(NotFoundError);
  });

  it("rolls the assignment and the shift back when the audit fact cannot be written", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    vi.spyOn(store, "writeAudit").mockRejectedValueOnce(new Error("audit down"));

    await expect(assign(store, fixture, shift.id)).rejects.toThrow("audit down");

    expect(store.shiftAssignments.size).toBe(0);
    expect(store.shifts.get(shift.id)?.state).toBe("open");
  });
});

describe("withdrawShiftAssignment", () => {
  it("withdraws the assignment and returns a published shift to published", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
    });
    const assignment = await assign(store, fixture, shift.id);

    const withdrawn = await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    expect(withdrawn.state).toBe("withdrawn");
    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "published" });

    const audit = store.audits.find((row) => row.action === "workforce.shift_assignment.withdrawn");
    expect(audit?.before).toEqual({ state: "approved", shift_state: "assigned" });
    expect(audit?.after).toEqual({ state: "withdrawn", shift_state: "published" });
  });

  it("returns a never-published shift to open", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "open" });
  });

  it("rejects withdrawing an assignment that is not approved", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    const withdraw = () =>
      withdrawShiftAssignment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: assignment.id,
      });
    await withdraw();

    await expect(withdraw()).rejects.toThrow(/cannot be withdrawn/);
  });

  it("refuses to withdraw an approved assignment once the shift is completed", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    await completeShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: shift.id,
    });

    await expect(
      withdrawShiftAssignment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: assignment.id,
      }),
    ).rejects.toThrow(new DomainError("the shift is not in an assigned state"));

    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "completed" });
    expect(
      await findShiftAssignment(store, {
        organizationId: fixture.organizationId,
        shiftAssignmentId: assignment.id,
      }),
    ).toMatchObject({ state: "approved" });
  });

  it("refuses to withdraw an approved assignment once the shift is cancelled", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    // `cancelShift` now refuses an assigned shift, but an approved assignment can
    // still outlive its shift (legacy data or another writer), so force the
    // precondition directly to exercise the withdrawal guard in isolation.
    await store.updateShift({
      organizationId: fixture.organizationId,
      shiftId: shift.id,
      state: "cancelled",
    });

    await expect(
      withdrawShiftAssignment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: assignment.id,
      }),
    ).rejects.toThrow(new DomainError("the shift is not in an assigned state"));

    expect(
      await findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).toMatchObject({ state: "cancelled" });
    expect(
      await findShiftAssignment(store, {
        organizationId: fixture.organizationId,
        shiftAssignmentId: assignment.id,
      }),
    ).toMatchObject({ state: "approved" });
  });

  it("re-reads the assignment under the lock so a double withdrawal cannot double-revert", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    const realFind = store.findShiftAssignment.bind(store);
    let calls = 0;
    vi.spyOn(store, "findShiftAssignment").mockImplementation(async (query) => {
      calls += 1;
      const found = await realFind(query);
      // Mimic a concurrent withdrawal committing between the first load and the
      // re-read taken under the shift lock.
      return calls === 1 || found === undefined ? found : { ...found, state: "withdrawn" };
    });

    await expect(
      withdrawShiftAssignment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: assignment.id,
      }),
    ).rejects.toThrow(/cannot be withdrawn/);

    expect(calls).toBe(2);
    expect(store.shifts.get(shift.id)?.state).toBe("assigned");
    expect(store.shiftAssignments.get(assignment.id)?.state).toBe("approved");
  });

  it("is a typed not-found for a missing or cross-organization assignment", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await expect(
      withdrawShiftAssignment(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: assignment.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      withdrawShiftAssignment(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: "nope",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("findShift", () => {
  it("is organization-scoped", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);

    await expect(
      findShift(store, { organizationId: fixture.organizationId, shiftId: shift.id }),
    ).resolves.toMatchObject({ id: shift.id });
    await expect(
      findShift(store, { organizationId: fixture.otherOrganizationId, shiftId: shift.id }),
    ).resolves.toBeUndefined();
  });
});

describe("findShiftAssignment", () => {
  it("is organization-scoped", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await expect(
      findShiftAssignment(store, {
        organizationId: fixture.organizationId,
        shiftAssignmentId: assignment.id,
      }),
    ).resolves.toMatchObject({ id: assignment.id });
    await expect(
      findShiftAssignment(store, {
        organizationId: fixture.otherOrganizationId,
        shiftAssignmentId: assignment.id,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listShifts", () => {
  it("defaults the page limit and never returns an unbounded rota", async () => {
    const { store, fixture } = setup();
    const spy = vi.spyOn(store, "listShifts");

    await listShifts(store, { organizationId: fixture.organizationId });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ limit: DEFAULT_SHIFT_LIMIT }));
  });

  it("rejects an unknown state filter", async () => {
    const { store, fixture } = setup();

    await expect(
      listShifts(store, { organizationId: fixture.organizationId, state: "nonsense" }),
    ).rejects.toThrow(/state must be one of/);
  });

  it("filters by location, state and an inclusive starts-at window", async () => {
    const { store, fixture } = setup();
    const early = await plan(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T12:00:00.000Z",
    });
    const late = await plan(store, fixture, {
      locationId: fixture.otherLocationId,
      startsAt: "2026-08-01T08:00:00.000Z",
      endsAt: "2026-08-01T12:00:00.000Z",
    });
    await publishShift(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftId: early.id,
    });

    const inWindow = await listShifts(store, {
      organizationId: fixture.organizationId,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.000Z",
    });
    expect(inWindow.map((row) => row.id)).toEqual([early.id]);

    const byLocation = await listShifts(store, {
      organizationId: fixture.organizationId,
      locationId: fixture.otherLocationId,
    });
    expect(byLocation.map((row) => row.id)).toEqual([late.id]);

    const published = await listShifts(store, {
      organizationId: fixture.organizationId,
      state: "published",
    });
    expect(published.map((row) => row.id)).toEqual([early.id]);
  });

  it("orders by starts-at then id and is organization-scoped", async () => {
    const { store, fixture } = setup();
    const first = await plan(store, fixture, {
      startsAt: "2026-07-02T08:00:00.000Z",
      endsAt: "2026-07-02T12:00:00.000Z",
    });
    const second = await plan(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T12:00:00.000Z",
    });
    const otherOrgShift = await createShift(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      locationId: fixture.otherLocationId,
      startsAt: "2026-06-01T08:00:00.000Z",
      endsAt: "2026-06-01T12:00:00.000Z",
    });

    const rows = await listShifts(store, { organizationId: fixture.organizationId });

    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows.map((row) => row.id)).not.toContain(otherOrgShift.id);
  });

  it("pages with limit and offset", async () => {
    const { store, fixture } = setup();
    await plan(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T12:00:00.000Z",
    });
    const second = await plan(store, fixture, {
      startsAt: "2026-07-02T08:00:00.000Z",
      endsAt: "2026-07-02T12:00:00.000Z",
    });

    const page = await listShifts(store, {
      organizationId: fixture.organizationId,
      limit: 1,
      offset: 1,
    });

    expect(page.map((row) => row.id)).toEqual([second.id]);
  });
});

describe("listShiftAssignments", () => {
  it("defaults the page limit", async () => {
    const { store, fixture } = setup();
    const spy = vi.spyOn(store, "listShiftAssignments");

    await listShiftAssignments(store, { organizationId: fixture.organizationId });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: DEFAULT_SHIFT_ASSIGNMENT_LIMIT }),
    );
  });

  it("rejects an unknown state filter", async () => {
    const { store, fixture } = setup();

    await expect(
      listShiftAssignments(store, { organizationId: fixture.organizationId, state: "nonsense" }),
    ).rejects.toThrow(/state must be one of/);
  });

  it("filters by shift, employee and state and is organization-scoped", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    const otherOrgShift = await createShift(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      locationId: fixture.otherLocationId,
      startsAt: STARTS,
      endsAt: ENDS,
    });
    await assignShift(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      shiftId: otherOrgShift.id,
      employeeId: fixture.otherEmployeeId,
    });

    const rows = await listShiftAssignments(store, {
      organizationId: fixture.organizationId,
      shiftId: shift.id,
      employeeId: fixture.employeeId,
      state: "approved",
    });

    expect(rows.map((row) => row.id)).toEqual([assignment.id]);
  });

  it("filters withdrawn assignments out of the approved page", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    const approved = await listShiftAssignments(store, {
      organizationId: fixture.organizationId,
      state: "approved",
    });
    const withdrawn = await listShiftAssignments(store, {
      organizationId: fixture.organizationId,
      state: "withdrawn",
    });

    expect(approved).toHaveLength(0);
    expect(withdrawn.map((row) => row.id)).toEqual([assignment.id]);
  });
});

function adjust(
  store: FakeSchedulingStore,
  fixture: SchedulingFixture,
  shiftAssignmentId: string,
  overrides: Partial<{ adjustedHours: string; reason: string }> = {},
) {
  return createShiftAdjustment(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    shiftAssignmentId,
    adjustedHours: "7.5",
    reason: "late clock-in",
    ...overrides,
  });
}

describe("createShiftAdjustment", () => {
  it("records an approved, actor-stamped correction with its audit fact", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    const adjustment = await adjust(store, fixture, assignment.id, {
      adjustedHours: "6.25",
      reason: "  early departure  ",
    });

    expect(adjustment).toMatchObject({
      organizationId: fixture.organizationId,
      shiftAssignmentId: assignment.id,
      adjustedHours: "6.25",
      reason: "early departure",
      approvedBy: fixture.actorId,
    });
    expect(adjustment.approvedAt).toEqual(expect.any(String));

    const audit = store.audits.find((row) => row.action === "workforce.shift_adjustment.created");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "shift_adjustment",
      entityId: adjustment.id,
      after: {
        shift_assignment_id: assignment.id,
        adjusted_hours: "6.25",
        reason: "early departure",
        approved_by: fixture.actorId,
      },
    });
  });

  it("normalises a whole-number correction to two decimal places", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    const adjustment = await adjust(store, fixture, assignment.id, { adjustedHours: "8" });

    expect(adjustment.adjustedHours).toBe("8.00");
  });

  it("rejects a correction on a withdrawn assignment", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    await withdrawShiftAssignment(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      shiftAssignmentId: assignment.id,
    });

    await expect(adjust(store, fixture, assignment.id)).rejects.toThrow(/cannot be adjusted/);
    expect(store.shiftAdjustments.size).toBe(0);
  });

  it("rejects a blank assignment id, a bad decimal and a blank reason", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await expect(adjust(store, fixture, "   ")).rejects.toThrow(
      new DomainError("shiftAssignmentId is required"),
    );
    await expect(adjust(store, fixture, assignment.id, { adjustedHours: "abc" })).rejects.toThrow(
      /not a valid decimal string/,
    );
    await expect(adjust(store, fixture, assignment.id, { adjustedHours: "-1" })).rejects.toThrow(
      /must not be negative/,
    );
    await expect(adjust(store, fixture, assignment.id, { adjustedHours: "7.505" })).rejects.toThrow(
      /more than 2 decimal places/,
    );
    await expect(
      adjust(store, fixture, assignment.id, { adjustedHours: 7.5 as unknown as string }),
    ).rejects.toThrow(/must be a decimal string/);
    await expect(adjust(store, fixture, assignment.id, { reason: "   " })).rejects.toThrow(
      new DomainError("reason is required"),
    );
    expect(store.shiftAdjustments.size).toBe(0);
  });

  it("rejects a correction above the numeric(9,2) ceiling but accepts the exact bound", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);

    await expect(
      adjust(store, fixture, assignment.id, { adjustedHours: "10000000" }),
    ).rejects.toThrow(new DomainError("adjustedHours is out of range"));
    expect(store.shiftAdjustments.size).toBe(0);

    await expect(
      adjust(store, fixture, assignment.id, { adjustedHours: "9999999.99" }),
    ).resolves.toMatchObject({ adjustedHours: "9999999.99" });
  });

  it("is a typed not-found for a missing or cross-organization assignment", async () => {
    const { store, fixture } = setup();

    await expect(adjust(store, fixture, "nope")).rejects.toThrow(NotFoundError);
    await expect(
      createShiftAdjustment(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        shiftAssignmentId: "nope",
        adjustedHours: "7.5",
        reason: "late clock-in",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rolls the correction back when its audit fact cannot be written", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    vi.spyOn(store, "writeAudit").mockRejectedValueOnce(new Error("audit down"));

    await expect(adjust(store, fixture, assignment.id)).rejects.toThrow("audit down");
    expect(store.shiftAdjustments.size).toBe(0);
  });
});

describe("findShiftAdjustment", () => {
  it("is organization-scoped", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    const adjustment = await adjust(store, fixture, assignment.id);

    await expect(
      findShiftAdjustment(store, {
        organizationId: fixture.organizationId,
        shiftAdjustmentId: adjustment.id,
      }),
    ).resolves.toMatchObject({ id: adjustment.id });
    await expect(
      findShiftAdjustment(store, {
        organizationId: fixture.otherOrganizationId,
        shiftAdjustmentId: adjustment.id,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listShiftAdjustments", () => {
  it("defaults the page limit", async () => {
    const { store, fixture } = setup();
    const spy = vi.spyOn(store, "listShiftAdjustments");

    await listShiftAdjustments(store, { organizationId: fixture.organizationId });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: DEFAULT_SHIFT_ADJUSTMENT_LIMIT }),
    );
  });

  it("filters by assignment and is organization-scoped", async () => {
    const { store, fixture } = setup();
    const shift = await plan(store, fixture);
    const assignment = await assign(store, fixture, shift.id);
    const first = await adjust(store, fixture, assignment.id);
    const second = await adjust(store, fixture, assignment.id, { adjustedHours: "5" });

    const rows = await listShiftAdjustments(store, {
      organizationId: fixture.organizationId,
      shiftAssignmentId: assignment.id,
    });

    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(
      await listShiftAdjustments(store, { organizationId: fixture.otherOrganizationId }),
    ).toEqual([]);
  });
});

describe("computeWorkedHours", () => {
  it("sums per-employee hours, applying adjustments, ordered by name", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: fixture.employeeId,
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Nora Nordmann",
      baseHourlyRate: "215.5000",
    });
    seedSchedulingEmployee(store, {
      id: "employee-3",
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Ana Andersen",
      baseHourlyRate: "200.0000",
    });

    const shiftA = await plan(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T16:00:00.000Z",
    });
    const shiftB = await plan(store, fixture, {
      startsAt: "2026-07-02T08:00:00.000Z",
      endsAt: "2026-07-02T12:00:00.000Z",
    });
    const assignmentA = await assign(store, fixture, shiftA.id);
    await assign(store, fixture, shiftB.id, { employeeId: "employee-3" });

    // Nora's 8 h shift is corrected to 6.50 h; the adjustment wins.
    await adjust(store, fixture, assignmentA.id, { adjustedHours: "6.5" });

    const result = await computeWorkedHours(store, {
      organizationId: fixture.organizationId,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
    });

    expect(result).toEqual({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
      rows: [
        {
          employeeId: "employee-3",
          employeeName: "Ana Andersen",
          roleCode: "barista",
          hours: "4.00",
          hourlyRate: "200.0000",
        },
        {
          employeeId: fixture.employeeId,
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "6.50",
          hourlyRate: "215.5000",
        },
      ],
      totalHours: "10.50",
    });
  });

  it("narrows by employee, location and period", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: fixture.employeeId,
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Nora Nordmann",
    });
    seedSchedulingEmployee(store, {
      id: "employee-3",
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Ana Andersen",
    });
    const shiftA = await plan(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T16:00:00.000Z",
    });
    const shiftB = await plan(store, fixture, {
      startsAt: "2026-07-02T08:00:00.000Z",
      endsAt: "2026-07-02T12:00:00.000Z",
    });
    await assign(store, fixture, shiftA.id);
    await assign(store, fixture, shiftB.id, { employeeId: "employee-3" });

    const byEmployee = await computeWorkedHours(store, {
      organizationId: fixture.organizationId,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
      employeeId: fixture.employeeId,
    });
    expect(byEmployee.rows.map((row) => row.employeeName)).toEqual(["Nora Nordmann"]);
    expect(byEmployee.totalHours).toBe("8.00");

    const byLocation = await computeWorkedHours(store, {
      organizationId: fixture.organizationId,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
      locationId: fixture.otherLocationId,
    });
    expect(byLocation.rows).toEqual([]);
    expect(byLocation.totalHours).toBe("0.00");

    const windowed = await computeWorkedHours(store, {
      organizationId: fixture.organizationId,
      from: "2026-07-02T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
    });
    expect(windowed.rows.map((row) => row.employeeName)).toEqual(["Ana Andersen"]);
    expect(windowed.totalHours).toBe("4.00");
  });

  it("rejects a non-advancing or malformed window", async () => {
    const { store, fixture } = setup();

    await expect(
      computeWorkedHours(store, {
        organizationId: fixture.organizationId,
        from: "2026-07-02T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(new DomainError("from must be before to"));
    await expect(
      computeWorkedHours(store, {
        organizationId: fixture.organizationId,
        from: "2026-07-01",
        to: "2026-07-03T00:00:00.000Z",
      }),
    ).rejects.toThrow(/from must be an ISO-8601 instant/);
  });
});

const PAYROLL_PERIOD = { periodStart: "2026-07-01", periodEnd: "2026-07-31" } as const;

/** Plans a shift, publishes it and assigns the fixture employee (approved). */
async function workedShift(
  store: FakeSchedulingStore,
  fixture: SchedulingFixture,
  overrides: Partial<CreateShiftInput> = {},
) {
  const shift = await plan(store, fixture, overrides);
  await publishShift(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    shiftId: shift.id,
  });
  await assign(store, fixture, shift.id);
  return shift;
}

function generate(
  store: FakeSchedulingStore,
  fixture: SchedulingFixture,
  overrides: Partial<GeneratePayrollReportInput> = {},
) {
  return generatePayrollReport(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    ...PAYROLL_PERIOD,
    ...overrides,
  });
}

describe("generatePayrollReport", () => {
  it("freezes the hours, rate and expected pay into the snapshot and audits it", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: fixture.employeeId,
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Nora Nordmann",
      baseHourlyRate: "215.5000",
    });
    await workedShift(store, fixture, {
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T16:00:00.000Z",
    });

    const report = await generate(store, fixture);

    expect(report).toMatchObject({
      organizationId: fixture.organizationId,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      status: "generated",
      generatedBy: fixture.actorId,
      exportFileId: null,
    });
    expect(report.generatedAt).toEqual(expect.any(String));
    expect(report.snapshot).toEqual({
      schemaVersion: 1,
      currency: "NOK",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      lines: [
        {
          employeeId: fixture.employeeId,
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "8.00",
          hourlyRate: "215.5000",
          expectedPay: "1724.0000",
        },
      ],
      totalHours: "8.00",
      totalExpectedPay: "1724.0000",
    });

    const audit = store.audits.find((row) => row.action === "workforce.payroll_report.generated");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "payroll_report",
      entityId: report.id,
      after: {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        status: "generated",
        total_hours: "8.00",
        total_expected_pay: "1724.0000",
        line_count: 1,
      },
    });
  });

  it("includes the whole periodEnd day and excludes the following day", async () => {
    const { store, fixture } = setup();
    seedSchedulingEmployee(store, {
      id: fixture.employeeId,
      organizationId: fixture.organizationId,
      primaryLocationId: fixture.locationId,
      roleCode: "barista",
      name: "Nora Nordmann",
    });
    await workedShift(store, fixture, {
      startsAt: "2026-07-31T08:00:00.000Z",
      endsAt: "2026-07-31T16:00:00.000Z",
    });
    await workedShift(store, fixture, {
      startsAt: "2026-08-01T08:00:00.000Z",
      endsAt: "2026-08-01T16:00:00.000Z",
    });

    const report = await generate(store, fixture);

    expect(report.snapshot).toMatchObject({ totalHours: "8.00" });
  });

  it("builds an empty snapshot with zero totals for a period with no hours", async () => {
    const { store, fixture } = setup();

    const report = await generate(store, fixture);

    expect(report.status).toBe("generated");
    expect(report.snapshot).toMatchObject({
      lines: [],
      totalHours: "0.00",
      totalExpectedPay: "0.0000",
    });
  });

  it("supersedes a prior same-period report before inserting the replacement", async () => {
    const { store, fixture } = setup();
    const first = await generate(store, fixture);
    const second = await generate(store, fixture, { actorId: "actor-2" });

    expect(
      await findPayrollReport(store, {
        organizationId: fixture.organizationId,
        payrollReportId: first.id,
      }),
    ).toMatchObject({ status: "superseded" });
    expect(second.status).toBe("generated");
    expect(store.payrollReports.size).toBe(2);

    const supersede = store.audits.find(
      (row) => row.action === "workforce.payroll_report.superseded",
    );
    expect(supersede).toMatchObject({
      actorId: "actor-2",
      entityId: first.id,
      before: { status: "generated" },
      after: { status: "superseded" },
    });
    // The partial unique `(organization, period_start)` key leaves exactly one live report.
    expect(
      (
        await listPayrollReports(store, {
          organizationId: fixture.organizationId,
          status: "generated",
        })
      ).map((row) => row.id),
    ).toEqual([second.id]);
  });

  it("resolves the prior period report through the row lock before superseding and inserting", async () => {
    const { store, fixture } = setup();
    const first = await generate(store, fixture);

    const lock = vi.spyOn(store, "lockPayrollReportForPeriod");
    const supersede = vi.spyOn(store, "updatePayrollReport");
    const insert = vi.spyOn(store, "createPayrollReport");

    await generate(store, fixture);

    expect(lock).toHaveBeenCalledWith({
      organizationId: fixture.organizationId,
      periodStart: PAYROLL_PERIOD.periodStart,
    });
    expect(supersede).toHaveBeenCalledWith(
      expect.objectContaining({ payrollReportId: first.id, status: "superseded" }),
    );
    // The lock read must happen before the supersede and the replacement insert.
    expect(lock.mock.invocationCallOrder[0]!).toBeLessThan(supersede.mock.invocationCallOrder[0]!);
    expect(lock.mock.invocationCallOrder[0]!).toBeLessThan(insert.mock.invocationCallOrder[0]!);
  });

  it("keeps exactly one live report across repeated regenerations", async () => {
    const { store, fixture } = setup();
    const first = await generate(store, fixture);
    const second = await generate(store, fixture);
    const third = await generate(store, fixture);

    expect(store.payrollReports.size).toBe(3);
    // The third regeneration must resolve the live second report (not the
    // retained superseded first) and supersede it, leaving one live report.
    expect(
      (
        await listPayrollReports(store, {
          organizationId: fixture.organizationId,
          status: "generated",
        })
      ).map((row) => row.id),
    ).toEqual([third.id]);
    await expect(
      findPayrollReport(store, {
        organizationId: fixture.organizationId,
        payrollReportId: first.id,
      }),
    ).resolves.toMatchObject({ status: "superseded" });
    await expect(
      findPayrollReport(store, {
        organizationId: fixture.organizationId,
        payrollReportId: second.id,
      }),
    ).resolves.toMatchObject({ status: "superseded" });
  });

  it("rejects malformed dates and a non-advancing period", async () => {
    const { store, fixture } = setup();

    await expect(generate(store, fixture, { periodStart: "2026-07-32" })).rejects.toThrow(
      /periodStart must be a date/,
    );
    await expect(generate(store, fixture, { periodEnd: "2026-07-01" })).rejects.toThrow(
      new DomainError("periodEnd must be after periodStart"),
    );
    expect(store.payrollReports.size).toBe(0);
  });

  it("rolls the report back when its audit fact cannot be written", async () => {
    const { store, fixture } = setup();
    vi.spyOn(store, "writeAudit").mockRejectedValueOnce(new Error("audit down"));

    await expect(generate(store, fixture)).rejects.toThrow("audit down");
    expect(store.payrollReports.size).toBe(0);
  });
});

describe("markPayrollReportExported", () => {
  it("exports a generated report and links the artifact", async () => {
    const { store, fixture } = setup();
    const report = await generate(store, fixture);

    const exported = await markPayrollReportExported(store, {
      organizationId: fixture.organizationId,
      payrollReportId: report.id,
      exportFileId: "file-1",
      actorId: fixture.actorId,
    });

    expect(exported).toMatchObject({ status: "exported", exportFileId: "file-1" });
    expect(exported.updatedAt).not.toBeNull();

    const audit = store.audits.find((row) => row.action === "workforce.payroll_report.exported");
    expect(audit).toMatchObject({
      entityId: report.id,
      before: { status: "generated", export_file_id: null },
      after: { status: "exported", export_file_id: "file-1" },
    });
  });

  it("leaves the export link null when no artifact is given", async () => {
    const { store, fixture } = setup();
    const report = await generate(store, fixture);

    const exported = await markPayrollReportExported(store, {
      organizationId: fixture.organizationId,
      payrollReportId: report.id,
      actorId: fixture.actorId,
    });

    expect(exported).toMatchObject({ status: "exported", exportFileId: null });
  });

  it("refuses to export anything but a generated report", async () => {
    const { store, fixture } = setup();
    const report = await generate(store, fixture);
    const exportIt = () =>
      markPayrollReportExported(store, {
        organizationId: fixture.organizationId,
        payrollReportId: report.id,
        actorId: fixture.actorId,
      });
    await exportIt();

    await expect(exportIt()).rejects.toThrow(/cannot be exported/);
  });

  it("refuses to export a superseded report", async () => {
    const { store, fixture } = setup();
    const first = await generate(store, fixture);
    await generate(store, fixture);

    await expect(
      markPayrollReportExported(store, {
        organizationId: fixture.organizationId,
        payrollReportId: first.id,
        actorId: fixture.actorId,
      }),
    ).rejects.toThrow(/cannot be exported/);
  });

  it("refuses to export a draft report", async () => {
    const { store, fixture } = setup();
    const draft = await store.createPayrollReport({
      organizationId: fixture.organizationId,
      periodStart: PAYROLL_PERIOD.periodStart,
      periodEnd: PAYROLL_PERIOD.periodEnd,
      generatedBy: fixture.actorId,
      status: "draft",
      snapshot: { lines: [] },
      createdBy: fixture.actorId,
    });

    await expect(
      markPayrollReportExported(store, {
        organizationId: fixture.organizationId,
        payrollReportId: draft.id,
        actorId: fixture.actorId,
      }),
    ).rejects.toThrow(/cannot be exported/);
  });

  it("is a typed not-found for a missing or cross-organization report", async () => {
    const { store, fixture } = setup();

    await expect(
      markPayrollReportExported(store, {
        organizationId: fixture.organizationId,
        payrollReportId: "nope",
        actorId: fixture.actorId,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      markPayrollReportExported(store, {
        organizationId: fixture.otherOrganizationId,
        payrollReportId: "nope",
        actorId: fixture.actorId,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("findPayrollReport", () => {
  it("is organization-scoped", async () => {
    const { store, fixture } = setup();
    const report = await generate(store, fixture);

    await expect(
      findPayrollReport(store, {
        organizationId: fixture.organizationId,
        payrollReportId: report.id,
      }),
    ).resolves.toMatchObject({ id: report.id });
    await expect(
      findPayrollReport(store, {
        organizationId: fixture.otherOrganizationId,
        payrollReportId: report.id,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listPayrollReports", () => {
  it("defaults the page limit", async () => {
    const { store, fixture } = setup();
    const spy = vi.spyOn(store, "listPayrollReports");

    await listPayrollReports(store, { organizationId: fixture.organizationId });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: DEFAULT_PAYROLL_REPORT_LIMIT }),
    );
  });

  it("rejects an unknown status filter", async () => {
    const { store, fixture } = setup();

    await expect(
      listPayrollReports(store, { organizationId: fixture.organizationId, status: "nonsense" }),
    ).rejects.toThrow(/status must be one of/);
  });

  it("orders newest period first, filters by status and pages", async () => {
    const { store, fixture } = setup();
    const june = await generate(store, fixture, {
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    const july = await generate(store, fixture, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    await markPayrollReportExported(store, {
      organizationId: fixture.organizationId,
      payrollReportId: july.id,
      actorId: fixture.actorId,
    });

    const all = await listPayrollReports(store, { organizationId: fixture.organizationId });
    expect(all.map((row) => row.id)).toEqual([july.id, june.id]);

    const exported = await listPayrollReports(store, {
      organizationId: fixture.organizationId,
      status: "exported",
    });
    expect(exported.map((row) => row.id)).toEqual([july.id]);

    const page = await listPayrollReports(store, {
      organizationId: fixture.organizationId,
      limit: 1,
      offset: 1,
    });
    expect(page.map((row) => row.id)).toEqual([june.id]);

    const fromJuly = await listPayrollReports(store, {
      organizationId: fixture.organizationId,
      periodStartFrom: "2026-07-01",
    });
    expect(fromJuly.map((row) => row.id)).toEqual([july.id]);

    expect(
      await listPayrollReports(store, { organizationId: fixture.otherOrganizationId }),
    ).toEqual([]);
  });
});
