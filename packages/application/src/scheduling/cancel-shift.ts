import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftRecord } from "./types";

export interface CancelShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly actorId: string;
}

/**
 * Cancels one planned shift (`WF-002`, `DEC-037`). The shift is locked
 * (`lockShift`) and loaded organization-scoped (`DEC-061`; a missing or
 * cross-organization id is a typed `NotFoundError`), then the transition is
 * checked: `completed` and `cancelled` are terminal, so cancelling either is a
 * `DomainError` rather than a silent no-op. Any live state (`open`, `published`,
 * `assigned`) may be cancelled. The transition and its audit fact commit or roll
 * back together.
 */
export async function cancelShift(
  store: SchedulingStore,
  input: CancelShiftInput,
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
    if (shift.state === "completed" || shift.state === "cancelled") {
      throw new DomainError(`shift in state ${shift.state} cannot be cancelled`);
    }

    const updated = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      state: "cancelled",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftCancelled,
      entityType: "shift",
      entityId: updated.id,
      before: { state: shift.state },
      after: { state: updated.state },
    });

    return updated;
  });
}
