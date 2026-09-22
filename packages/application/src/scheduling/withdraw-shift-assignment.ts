import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftAssignmentRecord } from "./types";

export interface WithdrawShiftAssignmentInput {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  readonly actorId: string;
}

/**
 * Withdraws one approved shift assignment (`WF-003`, `DEC-037`). The assignment
 * is loaded organization-scoped (`DEC-061`; a missing or cross-organization id
 * is a typed `NotFoundError`), then only an `approved` assignment may be
 * withdrawn (any other state is a `DomainError`).
 *
 * The shift is locked and moved back to `published` when it had been published
 * (`publishedAt` set) and to `open` otherwise — the withdrawal returns the shift
 * to the state it was in before it was assigned. The assignment update, the
 * shift update and the audit fact commit or roll back together.
 */
export async function withdrawShiftAssignment(
  store: SchedulingStore,
  input: WithdrawShiftAssignmentInput,
): Promise<ShiftAssignmentRecord> {
  if (isBlank(input.shiftAssignmentId)) {
    throw new DomainError("shiftAssignmentId is required");
  }

  return store.withTransaction(async (tx) => {
    const assignment = await tx.findShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: input.shiftAssignmentId.trim(),
    });
    if (assignment === undefined) {
      throw new NotFoundError("shift assignment not found in organization");
    }
    if (assignment.state !== "approved") {
      throw new DomainError(`shift assignment in state ${assignment.state} cannot be withdrawn`);
    }

    const shift = await tx.lockShift({
      organizationId: input.organizationId,
      shiftId: assignment.shiftId,
    });
    if (shift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    const updated = await tx.updateShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: assignment.id,
      state: "withdrawn",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("shift assignment not found in organization");
    }

    const shiftState = shift.publishedAt !== null ? "published" : "open";
    const updatedShift = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      state: shiftState,
      actorId: input.actorId,
    });
    if (updatedShift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftAssignmentWithdrawn,
      entityType: "shift_assignment",
      entityId: updated.id,
      before: { state: assignment.state, shift_state: shift.state },
      after: { state: updated.state, shift_state: updatedShift.state },
    });

    return updated;
  });
}
