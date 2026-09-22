import { DomainError, NotFoundError } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import { assertBreakMinutes } from "./create-shift";
import type { SchedulingStore, ShiftRecord } from "./types";

export interface UpdateShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  /** ISO instant. Omitted leaves the start unchanged. */
  readonly startsAt?: string;
  /** ISO instant. Omitted leaves the end unchanged. */
  readonly endsAt?: string;
  /** Whole minutes, non-negative. Omitted leaves the break unchanged. */
  readonly breakMinutes?: number;
  /** Free text; blank/`null` clears it. Omitted leaves it unchanged. */
  readonly roleCode?: string | null;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  startsAt: "starts_at",
  endsAt: "ends_at",
  breakMinutes: "break_minutes",
  roleCode: "role_code",
} as const;

/**
 * Amends one planned shift's time window, break or role (`WF-002`, `DEC-037`).
 * The row is loaded organization-scoped first (`DEC-061`; a missing or
 * cross-organization id is a typed `NotFoundError`), then the patch is
 * validated and the resulting window recomputed from the untouched fields, so
 * a partial patch still yields `endsAt > startsAt`.
 *
 * The `state` is **not** patchable here: publishing, cancelling and completing
 * are lifecycle commands. A shift already `completed` or `cancelled` is
 * terminal and cannot be amended. An empty patch is rejected. The update and
 * its audit fact commit or roll back together.
 */
export async function updateShift(
  store: SchedulingStore,
  input: UpdateShiftInput,
): Promise<ShiftRecord> {
  if (isBlank(input.shiftId)) {
    throw new DomainError("shiftId is required");
  }

  return store.withTransaction(async (tx) => {
    const shift = await tx.findShift({
      organizationId: input.organizationId,
      shiftId: input.shiftId.trim(),
    });
    if (shift === undefined) {
      throw new NotFoundError("shift not found in organization");
    }
    if (shift.state === "completed" || shift.state === "cancelled") {
      throw new DomainError(`shift in state ${shift.state} cannot be updated`);
    }

    const mutable: {
      startsAt?: string;
      endsAt?: string;
      breakMinutes?: number;
      roleCode?: string | null;
    } = {};

    if (input.startsAt !== undefined) {
      assertIsoInstant(input.startsAt, "startsAt");
      mutable.startsAt = input.startsAt;
    }
    if (input.endsAt !== undefined) {
      assertIsoInstant(input.endsAt, "endsAt");
      mutable.endsAt = input.endsAt;
    }
    if (input.breakMinutes !== undefined) {
      mutable.breakMinutes = assertBreakMinutes(input.breakMinutes);
    }
    if (input.roleCode !== undefined) {
      mutable.roleCode =
        input.roleCode === null || isBlank(input.roleCode) ? null : input.roleCode.trim();
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const startsAt = mutable.startsAt ?? shift.startsAt;
    const endsAt = mutable.endsAt ?? shift.endsAt;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new DomainError("endsAt must be after startsAt");
    }

    const updated = await tx.updateShift({
      organizationId: input.organizationId,
      shiftId: shift.id,
      ...mutable,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("shift not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = shift[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftUpdated,
      entityType: "shift",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
