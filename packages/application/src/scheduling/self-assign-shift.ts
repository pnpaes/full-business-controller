import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import { resolveSelfEmployee } from "./resolve-self-employee";
import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

/** The weekly self-assigned-shift maximum when no override is supplied. */
export const DEFAULT_SELF_ASSIGN_WEEKLY_LIMIT = 2;

export interface SelfAssignShiftInput {
  readonly organizationId: string;
  /** The signed-in `app_user`; resolved to their sole linked employee row. */
  readonly actorUserId: string;
  readonly shiftId: string;
  /** Overrides `DEFAULT_SELF_ASSIGN_WEEKLY_LIMIT`; must be a non-negative integer. */
  readonly weeklyLimit?: number;
}

/**
 * The half-open UTC week `[weekStart, weekEnd)` containing `instant`, with the
 * week beginning Monday 00:00 UTC. Used to scope the weekly self-assignment
 * maximum (`WF-003`, `DEC-146`) to the shift's week.
 */
export function utcWeekBounds(instant: string): {
  readonly weekStart: string;
  readonly weekEnd: string;
} {
  const at = new Date(instant);
  const daysSinceMonday = (at.getUTCDay() + 6) % 7;
  const weekStart = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - daysSinceMonday),
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  return { weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() };
}

/**
 * An employee self-assigns one of their own shifts (`WF-003`, `DEC-146`). The
 * actor's `app_user` id resolves to their single linked `employee` row (zero or
 * more than one row fails closed, `resolveSelfEmployee`); the shift is locked
 * and must be `open` or `published`; the employee's `primaryLocationId` must
 * equal the shift's location (a null location is rejected, the `assign-shift`
 * rule); and a shift with a position (`DEC-151`) only accepts an employee who
 * **holds** that position — strict, with no override on the self path. An
 * existing assignment for the same `(shift, employee)` is rejected.
 *
 * The weekly maximum then applies: the employee's own self-originated
 * assignments (`assigned_by` null) that are live (`pending_approval` here, or
 * `self_assigned`/`approved` from another path) and overlap the shift's UTC week
 * are counted, and one more than the limit (default
 * `DEFAULT_SELF_ASSIGN_WEEKLY_LIMIT`, configurable) is refused with a
 * `DomainError`. The employee row is locked between the shift lock and the
 * count, so concurrent self-assigns by one employee serialise and the limit
 * holds.
 *
 * The assignment is created **`pending_approval`** with `assigned_by = null`
 * (the self marker) and the shift is deliberately left in its current state —
 * only a manager decision (`decideSelfAssignment`) approves it and moves the
 * shift to `assigned`. The assignment and its audit fact commit or roll back
 * together.
 */
export async function selfAssignShift(
  store: SchedulingStore,
  input: SelfAssignShiftInput,
): Promise<ShiftAssignmentRecord> {
  if (isBlank(input.shiftId)) {
    throw new DomainError("shiftId is required");
  }
  const weeklyLimit = input.weeklyLimit ?? DEFAULT_SELF_ASSIGN_WEEKLY_LIMIT;
  if (!Number.isInteger(weeklyLimit) || weeklyLimit < 0) {
    throw new DomainError("weeklyLimit must be a non-negative integer");
  }

  return store.withTransaction(async (tx) => {
    const shift = await tx.lockShift({
      organizationId: input.organizationId,
      shiftId: input.shiftId.trim(),
    });
    if (shift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }
    if (shift.state !== "open" && shift.state !== "published") {
      throw new DomainError(`shift in state ${shift.state} cannot take an assignment`);
    }

    const employee = resolveSelfEmployee(
      await tx.findEmployeesByUserId({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      }),
    );

    if (employee.primaryLocationId === null || employee.primaryLocationId !== shift.locationId) {
      throw new DomainError("employee must have a primary location matching the shift location");
    }
    if (shift.positionId !== null) {
      const held = await tx.listEmployeePositionIds({
        organizationId: input.organizationId,
        employeeId: employee.id,
      });
      if (!held.includes(shift.positionId)) {
        throw new DomainError("you do not hold the position this shift is staffed for");
      }
    }

    // Serialise per employee. The shift lock above only serialises two requests
    // for the *same* shift; two concurrent self-assigns by one employee on
    // different shifts would both count before either inserts and each pass the
    // weekly limit. Taking the employee row lock here (after the shift lock,
    // before the count) makes the count-then-insert atomic per employee
    // (`WF-003`, `DEC-146`). Acquisition order is always shift → employee, so
    // two transactions cannot form a lock cycle.
    await tx.lockEmployeeForSelfAssignment(employee.id);

    const existing = await tx.findShiftAssignmentByShiftEmployee({
      organizationId: input.organizationId,
      shiftId: shift.id,
      employeeId: employee.id,
    });
    if (existing !== undefined) {
      throw new DomainError("employee is already assigned to this shift");
    }

    const { weekStart, weekEnd } = utcWeekBounds(shift.startsAt);
    const used = await tx.countSelfAssignedShiftsInWeek({
      organizationId: input.organizationId,
      employeeId: employee.id,
      weekStart,
      weekEnd,
    });
    if (used >= weeklyLimit) {
      throw new DomainError(`weekly self-assignment limit of ${weeklyLimit} reached`);
    }

    const assignedAt = new Date().toISOString();
    const assignment = await tx.createShiftAssignment({
      organizationId: input.organizationId,
      shiftId: shift.id,
      employeeId: employee.id,
      state: "pending_approval",
      assignedBy: null,
      assignedAt,
      createdBy: input.actorUserId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorUserId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftAssignmentSelfRequested,
      entityType: "shift_assignment",
      entityId: assignment.id,
      before: { shift_state: shift.state, week_start: weekStart, week_end: weekEnd },
      after: {
        shift_id: assignment.shiftId,
        employee_id: assignment.employeeId,
        shift_position_id: shift.positionId,
        state: assignment.state,
        assigned_by: assignment.assignedBy,
        assigned_at: assignment.assignedAt,
        shift_state: shift.state,
        weekly_limit: weeklyLimit,
      },
    });

    return assignment;
  });
}
