import { DomainError, NotFoundError, WORKED_HOURS_SCALE, parseDecimal } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftAdjustmentRecord } from "./types";

/**
 * Validates a `numeric(9,2)` hours string (`WF-004`, `DEC-038`): a plain decimal
 * string (a JS number — a float — is rejected), non-negative and at most two
 * decimal places. The shape and decimal-place rules come from the domain
 * `parseDecimal` at `WORKED_HOURS_SCALE`; the non-negative rule is the
 * `shift_adjustment_adjusted_hours_check` counterpart applied here so the
 * fake-store suite and the API see one `DomainError`. The trimmed string is
 * returned, and decimals are never coerced to a number.
 */
export function assertAdjustedHours(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainError("adjustedHours must be a decimal string");
  }
  const trimmed = value.trim();
  const scaled = parseDecimal(trimmed, WORKED_HOURS_SCALE);
  if (scaled < 0n) {
    throw new DomainError("adjustedHours must not be negative");
  }
  return trimmed;
}

export interface CreateShiftAdjustmentInput {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** Decimal string (`numeric(9,2)`, hours — never a float); must be `>= 0`. */
  readonly adjustedHours: string;
  readonly reason: string;
  readonly actorId: string;
}

/**
 * Records a manual correction to one approved assignment's worked hours
 * (`WF-004`, `DEC-038`). Worked hours are derived from the registered shift;
 * a correction is an **append-only** `shift_adjustment` row, so the latest
 * correction wins at read time and the shift itself is never edited.
 *
 * `shiftAssignmentId` and `reason` must be non-blank and `adjustedHours` a
 * non-negative decimal string at 2 dp (`DomainError` otherwise). The assignment
 * is loaded organization-scoped (`DEC-061`; a missing or cross-organization id
 * is a typed `NotFoundError`) and only an `approved` assignment may be corrected
 * — a withdrawn/rejected/self-assigned assignment accepts no correction
 * (`DomainError`, mirroring the withdrawal guard). The correction is created
 * **approved by the actor** (`approvedBy`/`approvedAt`), and the row plus its
 * audit fact commit or roll back together.
 */
export async function createShiftAdjustment(
  store: SchedulingStore,
  input: CreateShiftAdjustmentInput,
): Promise<ShiftAdjustmentRecord> {
  if (isBlank(input.shiftAssignmentId)) {
    throw new DomainError("shiftAssignmentId is required");
  }
  const adjustedHours = assertAdjustedHours(input.adjustedHours);
  if (isBlank(input.reason)) {
    throw new DomainError("reason is required");
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
      throw new DomainError(`shift assignment in state ${assignment.state} cannot be adjusted`);
    }

    const approvedAt = new Date().toISOString();
    const adjustment = await tx.createShiftAdjustment({
      organizationId: input.organizationId,
      shiftAssignmentId: assignment.id,
      adjustedHours,
      reason: input.reason.trim(),
      approvedBy: input.actorId,
      approvedAt,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftAdjustmentCreated,
      entityType: "shift_adjustment",
      entityId: adjustment.id,
      after: {
        shift_assignment_id: adjustment.shiftAssignmentId,
        adjusted_hours: adjustment.adjustedHours,
        reason: adjustment.reason,
        approved_by: adjustment.approvedBy,
        approved_at: adjustment.approvedAt,
      },
    });

    return adjustment;
  });
}
