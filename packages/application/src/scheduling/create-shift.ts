import { DomainError } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { SCHEDULING_AUDIT_ACTIONS } from "./actions";
import type { SchedulingStore, ShiftRecord } from "./types";

/**
 * Validates a shift's unpaid break as a non-negative whole number of minutes
 * (the `shift_break_minutes_check` counterpart applied here so the fake-store
 * suite and the API see one `DomainError`). A non-number (including a numeric
 * string) and a fractional or negative value are rejected.
 */
export function assertBreakMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DomainError("breakMinutes must be a non-negative integer");
  }
  return value;
}

export interface CreateShiftInput {
  readonly organizationId: string;
  /** Required: a shift is always planned at one location (`WF-002`). */
  readonly locationId: string;
  /** `DEC-151`: the position the shift is staffed for; blank/omitted becomes null. */
  readonly positionId?: string | null;
  /** Legacy free-text employment role; retained (expand-only) until contracted. */
  readonly roleCode?: string | null;
  /** ISO instant; must carry a time and zone. */
  readonly startsAt: string;
  /** ISO instant; must be strictly after `startsAt`. */
  readonly endsAt: string;
  /** Whole minutes, non-negative; defaults to 0. */
  readonly breakMinutes?: number;
  readonly actorId: string;
}

/**
 * Plans one shift (`WF-002`, `DEC-037`): validates the location, the
 * `startsAt`/`endsAt` ISO instants (strictly increasing), the break and the
 * optional role, then creates the row and its audit fact in one transaction.
 * The create is organization-scoped through `input.organizationId`
 * (`DEC-061`).
 *
 * A new shift starts in `open` (the persistence default); publishing is a
 * separate lifecycle command. `assertIsoInstant` is reused from the inventory
 * slice so the instant wire form has one implementation across the domains, and
 * it rejects a `Date`-parseable value without seconds.
 */
export async function createShift(
  store: SchedulingStore,
  input: CreateShiftInput,
): Promise<ShiftRecord> {
  if (isBlank(input.locationId)) {
    throw new DomainError("locationId is required");
  }
  assertIsoInstant(input.startsAt, "startsAt");
  assertIsoInstant(input.endsAt, "endsAt");
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new DomainError("endsAt must be after startsAt");
  }
  const breakMinutes =
    input.breakMinutes === undefined ? 0 : assertBreakMinutes(input.breakMinutes);
  const roleCode =
    input.roleCode === undefined || input.roleCode === null || isBlank(input.roleCode)
      ? null
      : input.roleCode.trim();
  const positionId =
    input.positionId === undefined || input.positionId === null || isBlank(input.positionId)
      ? null
      : input.positionId.trim();

  return store.withTransaction(async (tx) => {
    if (positionId !== null) {
      const position = await tx.findPosition({ organizationId: input.organizationId, positionId });
      if (position === undefined) {
        throw new DomainError("position not found in organization");
      }
    }
    const shift = await tx.createShift({
      organizationId: input.organizationId,
      locationId: input.locationId.trim(),
      positionId,
      roleCode,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      breakMinutes,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SCHEDULING_AUDIT_ACTIONS.shiftCreated,
      entityType: "shift",
      entityId: shift.id,
      after: {
        location_id: shift.locationId,
        position_id: shift.positionId,
        role_code: shift.roleCode,
        starts_at: shift.startsAt,
        ends_at: shift.endsAt,
        break_minutes: shift.breakMinutes,
        state: shift.state,
      },
    });

    return shift;
  });
}
