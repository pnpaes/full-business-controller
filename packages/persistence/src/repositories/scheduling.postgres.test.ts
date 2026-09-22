import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { location, organization, shift, shiftAssignment } from "../schema";
import {
  createShift,
  createShiftAssignment,
  findShift,
  findShiftAssignment,
  findShiftAssignmentByShiftEmployee,
  listShiftAssignments,
  listShifts,
  lockShift,
  updateShift,
  updateShiftAssignment,
} from "./scheduling";
import {
  createTestEmployee,
  createTestLocation,
  createTestOrganization,
  createTestShift,
  createTestShiftAssignment,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("scheduling repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    locationId = (await createTestLocation(client.db, orgId)).id;
  });

  afterAll(async () => {
    if (client) {
      // Every shift and assignment is created inside a rolled-back transaction,
      // so the committed fixtures to unwind are the location and the
      // organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a shift and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createShift(tx, {
        organizationId: orgId,
        locationId,
        roleCode: "kitchen",
        startsAt: at("2026-03-01T08:00:00.000Z"),
        endsAt: at("2026-03-01T16:00:00.000Z"),
        breakMinutes: 30,
        createdBy: "00000000-0000-0000-0000-0000000000aa",
      });
      expect(created.locationId).toBe(locationId);
      expect(created.roleCode).toBe("kitchen");
      expect(created.startsAt.toISOString()).toBe("2026-03-01T08:00:00.000Z");
      expect(created.endsAt.toISOString()).toBe("2026-03-01T16:00:00.000Z");
      expect(created.breakMinutes).toBe(30);
      expect(created.state).toBe("open");
      expect(created.publishedAt).toBeNull();
      expect(created.actualStart).toBeNull();
      expect(created.actualEnd).toBeNull();
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000aa");

      expect((await findShift(tx, { organizationId: orgId, shiftId: created.id }))?.id).toBe(
        created.id,
      );

      // A row in another organization is invisible at this scope. If the
      // organization filter were dropped, this lookup would find the row and
      // the assertion would fail.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findShift(tx, { organizationId: otherOrgId, shiftId: created.id }),
      ).toBeUndefined();

      // The lock read takes the row's write lock and is equally scoped.
      expect((await lockShift(tx, { organizationId: orgId, shiftId: created.id }))?.id).toBe(
        created.id,
      );
      expect(
        await lockShift(tx, { organizationId: otherOrgId, shiftId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults a shift's break minutes, state and nullable fields", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestShift(tx, orgId, locationId);
      expect(created.breakMinutes).toBe(0);
      expect(created.state).toBe("open");
      expect(created.roleCode).toBeNull();
      expect(created.publishedAt).toBeNull();
      expect(created.actualStart).toBeNull();
      expect(created.actualEnd).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists shifts by location, state and starts_at window, ordered by starts_at, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const a = await createTestShift(tx, orgId, locationId, {
        startsAt: at("2026-03-01T08:00:00.000Z"),
        endsAt: at("2026-03-01T16:00:00.000Z"),
        state: "published",
      });
      const b = await createTestShift(tx, orgId, locationId, {
        startsAt: at("2026-03-02T08:00:00.000Z"),
        endsAt: at("2026-03-02T16:00:00.000Z"),
        state: "open",
      });
      const otherLocation = await createTestLocation(tx, orgId);
      const c = await createTestShift(tx, orgId, otherLocation.id, {
        startsAt: at("2026-03-03T08:00:00.000Z"),
        endsAt: at("2026-03-03T16:00:00.000Z"),
        state: "published",
      });

      // starts_at order (then id).
      const all = await listShifts(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const here = await listShifts(tx, { organizationId: orgId, locationId });
      expect(here.map((row) => row.id)).toEqual([a.id, b.id]);

      const published = await listShifts(tx, { organizationId: orgId, state: "published" });
      expect(published.map((row) => row.id)).toEqual([a.id, c.id]);

      // `from` is an inclusive lower bound, `to` an inclusive upper bound on
      // `starts_at`.
      const window = await listShifts(tx, {
        organizationId: orgId,
        from: a.startsAt,
        to: b.startsAt,
      });
      expect(window.map((row) => row.id)).toEqual([a.id, b.id]);
      const boundary = await listShifts(tx, {
        organizationId: orgId,
        from: b.startsAt,
        to: b.startsAt,
      });
      expect(boundary.map((row) => row.id)).toEqual([b.id]);

      const paged = await listShifts(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's rows never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherOrgLocation = await createTestLocation(tx, otherOrgId);
      await createTestShift(tx, otherOrgId, otherOrgLocation.id, {
        startsAt: at("2026-03-01T08:00:00.000Z"),
      });
      expect((await listShifts(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        a.id,
        b.id,
        c.id,
      ]);
    });
  });

  it("updates a shift's mutable fields and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestShift(tx, orgId, locationId);
      const published = at("2026-02-28T12:00:00.000Z");
      const updated = await updateShift(tx, {
        organizationId: orgId,
        shiftId: created.id,
        roleCode: null,
        startsAt: at("2026-03-01T09:00:00.000Z"),
        endsAt: at("2026-03-01T17:00:00.000Z"),
        breakMinutes: 45,
        state: "published",
        publishedAt: published,
        actorId: "00000000-0000-0000-0000-0000000000bb",
      });
      expect(updated?.roleCode).toBeNull();
      expect(updated?.startsAt.toISOString()).toBe("2026-03-01T09:00:00.000Z");
      expect(updated?.endsAt.toISOString()).toBe("2026-03-01T17:00:00.000Z");
      expect(updated?.breakMinutes).toBe(45);
      expect(updated?.state).toBe("published");
      expect(updated?.publishedAt?.toISOString()).toBe(published.toISOString());
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000bb");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("leaves an omitted shift field untouched and clears a nullable one with an explicit null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestShift(tx, orgId, locationId, {
        roleCode: "kitchen",
        breakMinutes: 15,
      });
      const updated = await updateShift(tx, {
        organizationId: orgId,
        shiftId: created.id,
        publishedAt: null,
      });
      expect(updated?.roleCode).toBe("kitchen");
      expect(updated?.breakMinutes).toBe(15);
      expect(updated?.publishedAt).toBeNull();
    });
  });

  it("does not update a shift through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestShift(tx, orgId, locationId, { state: "open" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateShift(tx, {
          organizationId: otherOrgId,
          shiftId: created.id,
          state: "cancelled",
        }),
      ).toBeUndefined();
      expect((await findShift(tx, { organizationId: orgId, shiftId: created.id }))?.state).toBe(
        "open",
      );
    });
  });

  it("rejects a shift state outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestShift(tx, orgId, locationId, { state: "pending" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_state_check/);
    });
  });

  it("rejects an ends_at that is not after starts_at", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestShift(tx, orgId, locationId, {
          startsAt: at("2026-03-01T16:00:00.000Z"),
          endsAt: at("2026-03-01T08:00:00.000Z"),
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_time_range_check/);
    });
  });

  it("rejects a negative break_minutes", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestShift(tx, orgId, locationId, { breakMinutes: -1 }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_break_minutes_check/);
    });
  });

  it("rejects an actual_end that is not after actual_start", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestShift(tx, orgId, locationId, {
          actualStart: at("2026-03-01T08:05:00.000Z"),
          actualEnd: at("2026-03-01T08:00:00.000Z"),
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_actual_range_check/);
    });
  });

  it("accepts a partial actual-time pair (the check skips a null side)", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestShift(tx, orgId, locationId, {
        actualStart: at("2026-03-01T08:05:00.000Z"),
        actualEnd: null,
      });
      expect(created.actualStart?.toISOString()).toBe("2026-03-01T08:05:00.000Z");
      expect(created.actualEnd).toBeNull();
    });
  });

  it("rejects a shift whose location is in another organization (0052)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `location` row (so the single-column FK passes), but
      // the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(createTestShift(tx, orgId, otherLocation.id));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift\.location_id/);
    });
  });

  it("creates an assignment and finds it by id and by shift/employee, organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const created = await createShiftAssignment(tx, {
        organizationId: orgId,
        shiftId: createdShift.id,
        employeeId: person.id,
        state: "approved",
        assignedBy: "00000000-0000-0000-0000-0000000000cc",
        assignedAt: at("2026-02-20T10:00:00.000Z"),
        createdBy: "00000000-0000-0000-0000-0000000000dd",
      });
      expect(created.shiftId).toBe(createdShift.id);
      expect(created.employeeId).toBe(person.id);
      expect(created.state).toBe("approved");
      expect(created.assignedBy).toBe("00000000-0000-0000-0000-0000000000cc");
      expect(created.assignedAt.toISOString()).toBe("2026-02-20T10:00:00.000Z");
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000dd");

      expect(
        (
          await findShiftAssignment(tx, {
            organizationId: orgId,
            shiftAssignmentId: created.id,
          })
        )?.id,
      ).toBe(created.id);
      expect(
        (
          await findShiftAssignmentByShiftEmployee(tx, {
            organizationId: orgId,
            shiftId: createdShift.id,
            employeeId: person.id,
          })
        )?.id,
      ).toBe(created.id);

      // Another organization's scope cannot see the row.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findShiftAssignment(tx, {
          organizationId: otherOrgId,
          shiftAssignmentId: created.id,
        }),
      ).toBeUndefined();
      expect(
        await findShiftAssignmentByShiftEmployee(tx, {
          organizationId: otherOrgId,
          shiftId: createdShift.id,
          employeeId: person.id,
        }),
      ).toBeUndefined();
    });
  });

  it("defaults an assignment's assigned_by to null (self-assigned)", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      expect(created.state).toBe("self_assigned");
      expect(created.assignedBy).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists assignments by shift, employee and state, ordered by assigned_at, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const otherShift = await createTestShift(tx, orgId, locationId, {
        startsAt: at("2026-03-02T08:00:00.000Z"),
        endsAt: at("2026-03-02T16:00:00.000Z"),
      });
      const personA = await createTestEmployee(tx, orgId);
      const personB = await createTestEmployee(tx, orgId);

      const a = await createTestShiftAssignment(
        tx,
        orgId,
        { shiftId: createdShift.id, employeeId: personA.id },
        { assignedAt: at("2026-02-20T08:00:00.000Z"), state: "approved" },
      );
      const b = await createTestShiftAssignment(
        tx,
        orgId,
        { shiftId: createdShift.id, employeeId: personB.id },
        { assignedAt: at("2026-02-21T08:00:00.000Z"), state: "pending_approval" },
      );
      const c = await createTestShiftAssignment(
        tx,
        orgId,
        { shiftId: otherShift.id, employeeId: personA.id },
        { assignedAt: at("2026-02-22T08:00:00.000Z"), state: "approved" },
      );

      const all = await listShiftAssignments(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const forShift = await listShiftAssignments(tx, {
        organizationId: orgId,
        shiftId: createdShift.id,
      });
      expect(forShift.map((row) => row.id)).toEqual([a.id, b.id]);

      const forEmployee = await listShiftAssignments(tx, {
        organizationId: orgId,
        employeeId: personA.id,
      });
      expect(forEmployee.map((row) => row.id)).toEqual([a.id, c.id]);

      const approved = await listShiftAssignments(tx, { organizationId: orgId, state: "approved" });
      expect(approved.map((row) => row.id)).toEqual([a.id, c.id]);

      const paged = await listShiftAssignments(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's assignments never leak in.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherOrgLocation = await createTestLocation(tx, otherOrgId);
      const otherOrgShift = await createTestShift(tx, otherOrgId, otherOrgLocation.id);
      const otherOrgPerson = await createTestEmployee(tx, otherOrgId);
      await createTestShiftAssignment(tx, otherOrgId, {
        shiftId: otherOrgShift.id,
        employeeId: otherOrgPerson.id,
      });
      expect(
        (await listShiftAssignments(tx, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([a.id, b.id, c.id]);
    });
  });

  it("updates an assignment's state and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      const updated = await updateShiftAssignment(tx, {
        organizationId: orgId,
        shiftAssignmentId: created.id,
        state: "approved",
        actorId: "00000000-0000-0000-0000-0000000000ee",
      });
      expect(updated?.state).toBe("approved");
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000ee");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("does not update an assignment through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateShiftAssignment(tx, {
          organizationId: otherOrgId,
          shiftAssignmentId: created.id,
          state: "approved",
        }),
      ).toBeUndefined();
      expect(
        (
          await findShiftAssignment(tx, {
            organizationId: orgId,
            shiftAssignmentId: created.id,
          })
        )?.state,
      ).toBe("self_assigned");
    });
  });

  it("rejects an assignment state outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const cause = await rejectionCause(
        createTestShiftAssignment(
          tx,
          orgId,
          { shiftId: createdShift.id, employeeId: person.id },
          { state: "assigned" },
        ),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_assignment_state_check/);
    });
  });

  it("rejects a second assignment of the same employee to the same shift (23505)", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      const cause = await rejectionCause(
        createTestShiftAssignment(tx, orgId, {
          shiftId: createdShift.id,
          employeeId: person.id,
        }),
      );
      expect(errorCode(cause)).toBe("23505");
      expect(cause.message).toMatch(/shift_assignment_shift_employee_key/);
    });
  });

  it("rejects an assignment whose shift is in another organization (0052)", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherOrgLocation = await createTestLocation(tx, otherOrgId);
      const otherOrgShift = await createTestShift(tx, otherOrgId, otherOrgLocation.id);
      const cause = await rejectionCause(
        createTestShiftAssignment(tx, orgId, {
          shiftId: otherOrgShift.id,
          employeeId: person.id,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_assignment\.shift_id/);
    });
  });

  it("rejects an assignment whose employee is in another organization (0052)", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherOrgPerson = await createTestEmployee(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestShiftAssignment(tx, orgId, {
          shiftId: createdShift.id,
          employeeId: otherOrgPerson.id,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/shift_assignment\.employee_id/);
    });
  });

  it("accepts an assignment inside one organization (0052)", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      expect(created.shiftId).toBe(createdShift.id);
      expect(created.employeeId).toBe(person.id);
    });
  });

  it("is not append-only: shift and assignment rows are mutable in the database", async () => {
    await inRollback(client.db, async (tx) => {
      const createdShift = await createTestShift(tx, orgId, locationId);
      const person = await createTestEmployee(tx, orgId);
      const assignment = await createTestShiftAssignment(tx, orgId, {
        shiftId: createdShift.id,
        employeeId: person.id,
      });
      // `DEC-037`/`DEC-038` record no append-only trigger on either table, so a
      // plain UPDATE and DELETE succeed (inside the rollback). The repository
      // still exposes the update path rather than a delete command.
      await tx
        .update(shiftAssignment)
        .set({ state: "approved" })
        .where(eq(shiftAssignment.id, assignment.id));
      await tx.update(shift).set({ state: "completed" }).where(eq(shift.id, createdShift.id));
      await tx.delete(shiftAssignment).where(eq(shiftAssignment.id, assignment.id));
      await tx.delete(shift).where(eq(shift.id, createdShift.id));
    });
  });
});
