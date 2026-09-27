import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

export interface DecideSelfAssignmentInput {
  readonly organizationId: string;
  /** The deciding manager (`SHIFT_WRITE_ROLES`); recorded as `assigned_by`. */
  readonly actorId: string;
  readonly assignmentId: string;
  readonly decision: "approved" | "rejected";
  /** Required non-blank when `decision` is `rejected`; recorded in the audit. */
  readonly reason?: string;
}

/**
 * A manager approves or rejects a pending self-assignment (`WF-003`,
 * `DEC-146`). Only a `pending_approval` row may be decided; the assignment is
 * loaded organization-scoped, the shift is locked, and the assignment is
 * re-read under that lock so a concurrent double-decision cannot write a
 * duplicate fact.
 *
 * `rejected` requires a non-blank `reason` (`DomainError` otherwise) and only
 * moves the assignment to `rejected` — the shift is left exactly as it was. The
 * reason is recorded in the audit fact: `shift_assignment` has no reason column
 * and this slice adds no migration.
 *
 * `approved` requires the shift to still be `open`/`published` (a
 * `cancelled`/`completed` shift cannot be assigned), sets the assignment
 * `approved` with `assigned_by = actorId`, and moves the shift to `assigned`.
 * The assignment update, the shift update and the audit fact commit or roll
 * back together.
 */
export async function decideSelfAssignment(
  store: SchedulingStore,
  input: DecideSelfAssignmentInput,
): Promise<ShiftAssignmentRecord> {
  if (isBlank(input.assignmentId)) {
    throw new DomainError("assignmentId is required");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new DomainError("decision must be approved or rejected");
  }
  const reason = input.reason?.trim() ?? "";
  if (input.decision === "rejected" && reason.length === 0) {
    throw new DomainError("reason is required to reject a self-assignment");
  }

  return store.withTransaction(async (tx) => {
    const assignment = await tx.findShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: input.assignmentId.trim(),
    });
    if (assignment === undefined) {
      throw new NotFoundError("shift assignment not found in organization");
    }
    if (assignment.state !== "pending_approval") {
      throw new DomainError(`shift assignment in state ${assignment.state} cannot be decided`);
    }

    const shift = await tx.lockShift({
      organizationId: input.organizationId,
      shiftId: assignment.shiftId,
    });
    if (shift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    // Re-read under the shift lock: a second concurrent decision must see the
    // first one's state, not decide the same pending row twice.
    const current = await tx.findShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: assignment.id,
    });
    if (current === undefined) {
      throw new NotFoundError("shift assignment not found in organization");
    }
    if (current.state !== "pending_approval") {
      throw new DomainError(`shift assignment in state ${current.state} cannot be decided`);
    }

    if (input.decision === "rejected") {
      const rejected = await tx.updateShiftAssignment({
        organizationId: input.organizationId,
        shiftAssignmentId: assignment.id,
        state: "rejected",
        actorId: input.actorId,
      });
      if (rejected === undefined) {
        throw new NotFoundError("shift assignment not found in organization");
      }

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: SCHEDULING_AUDIT_ACTIONS.shiftAssignmentRejected,
        entityType: "shift_assignment",
        entityId: rejected.id,
        before: { state: current.state, shift_state: shift.state },
        after: { state: rejected.state, reason, shift_state: shift.state },
      });

      return rejected;
    }

    if (shift.state !== "open" && shift.state !== "published") {
      throw new DomainError(`shift in state ${shift.state} cannot take an assignment`);
    }

    const approved = await tx.updateShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: assignment.id,
      state: "approved",
      assignedBy: input.actorId,
      actorId: input.actorId,
    });
    if (approved === undefined) {
      throw new NotFoundError("shift assignment not found in organization");
    }

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
      action: SCHEDULING_AUDIT_ACTIONS.shiftAssignmentApproved,
      entityType: "shift_assignment",
      entityId: approved.id,
      before: { state: current.state, shift_state: shift.state },
      after: {
        state: approved.state,
        assigned_by: approved.assignedBy,
        shift_state: updatedShift.state,
      },
    });

    return approved;
  });
}
