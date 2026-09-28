import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

export interface AssignShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly employeeId: string;
  /**
   * `DEC-151`: a manager may staff an exception — assign an employee who does
   * not hold the shift's position — only with this explicit, recorded override.
   * Omitted/false refuses the mismatch. (The self-assign path has no override.)
   */
  readonly override?: boolean;
  readonly actorId: string;
}

/**
 * Assigns one employee to one planned shift (`WF-003`, `DEC-037`). The shift is
 * locked (`lockShift`) and loaded organization-scoped (`DEC-061`; a missing or
 * cross-organization id is a typed `NotFoundError`), then:
 *
 * - only an `open` or `published` shift may take an assignment;
 * - the employee is resolved organization-scoped (missing → `NotFoundError`);
 * - **location rule** — the employee's `primaryLocationId` must equal the
 *   shift's location, and a null primary location is rejected (fail-closed, the
 *   `DEC-099` precedent);
 * - **position rule** (`DEC-151`) — a shift with a position only accepts an
 *   employee who holds it; a manager may override this with `override: true`,
 *   which is recorded in the audit payload (managers staff exceptions). A shift
 *   with no position accepts any employee;
 * - an existing assignment for the same `(shift, employee)` is rejected, so a
 *   retry cannot manufacture a duplicate fact.
 *
 * The assignment is created `approved` (manager-approved path, `assignedBy`
 * records the actor), the shift moves to `assigned`, and both facts plus the
 * audit entry commit or roll back together.
 */
export async function assignShift(
  store: SchedulingStore,
  input: AssignShiftInput,
): Promise<ShiftAssignmentRecord> {
  if (isBlank(input.shiftId)) {
    throw new DomainError("shiftId is required");
  }
  if (isBlank(input.employeeId)) {
    throw new DomainError("employeeId is required");
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

    const employee = await tx.findEmployee({
      organizationId: input.organizationId,
      employeeId: input.employeeId.trim(),
    });
    if (employee === undefined) {
      throw new NotFoundError("employee not found in organization");
    }
    if (employee.primaryLocationId === null || employee.primaryLocationId !== shift.locationId) {
      throw new DomainError("employee must have a primary location matching the shift location");
    }
    let positionOverride = false;
    if (shift.positionId !== null) {
      const held = await tx.listEmployeePositionIds({
        organizationId: input.organizationId,
        employeeId: employee.id,
      });
      if (!held.includes(shift.positionId)) {
        if (input.override !== true) {
          throw new DomainError(
            "the employee does not hold the shift's position; pass override to assign anyway",
          );
        }
        positionOverride = true;
      }
    }

    const existing = await tx.findShiftAssignmentByShiftEmployee({
      organizationId: input.organizationId,
      shiftId: shift.id,
      employeeId: employee.id,
    });
    if (existing !== undefined) {
      throw new DomainError("employee is already assigned to this shift");
    }

    const assignedAt = new Date().toISOString();
    const assignment = await tx.createShiftAssignment({
      organizationId: input.organizationId,
      shiftId: shift.id,
      employeeId: employee.id,
      state: "approved",
      assignedBy: input.actorId,
      assignedAt,
      createdBy: input.actorId,
    });

    const updatedShift = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      state: "assigned",
      actorId: input.actorId,
    });
    if (updatedShift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftAssignmentCreated,
      entityType: "shift_assignment",
      entityId: assignment.id,
      before: { shift_state: shift.state },
      after: {
        shift_id: assignment.shiftId,
        employee_id: assignment.employeeId,
        shift_position_id: shift.positionId,
        position_override: positionOverride,
        state: assignment.state,
        assigned_by: assignment.assignedBy,
        assigned_at: assignment.assignedAt,
        shift_state: updatedShift.state,
      },
    });

    return assignment;
  });
}
