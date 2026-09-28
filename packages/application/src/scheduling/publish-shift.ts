import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftRecord } from "./types";

export interface PublishShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly actorId: string;
}

/**
 * Publishes one planned shift (`WF-002`, `DEC-037`) so it becomes visible for
 * assignment. The shift is locked (`lockShift`) and loaded organization-scoped
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`),
 * then the transition is checked: only an `open` shift may be published, so a
 * repeat publish or publishing an already-assigned/completed shift is a
 * `DomainError` rather than a silent no-op. The rows store the `published_at`
 * stamp, and the transition and its audit fact commit or roll back together.
 */
export async function publishShift(
  store: SchedulingStore,
  input: PublishShiftInput,
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
    if (shift.state !== "open") {
      throw new DomainError(`shift in state ${shift.state} cannot be published`);
    }
    // `DEC-151`: a published shift is offered to self-assignment, and the offer
    // is matched on the shift's position — so a position is required to publish.
    if (shift.positionId === null) {
      throw new DomainError("a shift must have a position before it can be published");
    }

    const publishedAt = new Date().toISOString();
    const updated = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      state: "published",
      publishedAt,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftPublished,
      entityType: "shift",
      entityId: updated.id,
      before: { state: shift.state, published_at: shift.publishedAt },
      after: { state: updated.state, published_at: updated.publishedAt },
    });

    return updated;
  });
}
