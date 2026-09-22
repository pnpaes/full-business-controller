import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftRecord } from "./types";

export interface CompleteShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly actorId: string;
}

/**
 * Completes one shift after it has been worked (`WF-002`, `WF-004`,
 * `DEC-038`). The shift is locked (`lockShift`) and loaded organization-scoped
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`),
 * then the transition is checked: only a `published` or `assigned` shift may be
 * completed, so completing an `open`, `cancelled` or already `completed` shift
 * is a `DomainError` rather than a silent no-op. The transition and its audit
 * fact commit or roll back together.
 */
export async function completeShift(
  store: SchedulingStore,
  input: CompleteShiftInput,
): Promise<ShiftRecord> {
  if (isBlank(input.shiftId)) {
    throw new DomainError("shiftId is required");
  }

  return store.withTransaction(async (tx) => {
    const shift = await tx.lockShift({
      organizationId: input.organizationId,
      shiftId: input.shiftId.trim(),
    });
    if (shift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }
    if (shift.state !== "published" && shift.state !== "assigned") {
      throw new DomainError(`shift in state ${shift.state} cannot be completed`);
    }

    const updated = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      state: "completed",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftCompleted,
      entityType: "shift",
      entityId: updated.id,
      before: { state: shift.state },
      after: { state: updated.state },
    });

    return updated;
  });
}
