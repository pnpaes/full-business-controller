import { DomainError } from "@aquarela/domain";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import type { PositionRecord, WorkforceStore } from "./types";

/** The maximum length of a position code or name (a sanity bound). */
export const MAX_POSITION_TEXT = 100;

export interface RegisterPositionInput {
  readonly organizationId: string;
  /** Unique per organization; lower-cased and trimmed. */
  readonly code: string;
  readonly name: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly activeTo?: string | null;
  readonly actorId: string;
}

/**
 * Registers one position in the open, organization-scoped catalogue (`DEC-151`).
 * Validates the code (non-blank, bounded, unique per organization after
 * lower-casing/trimming) and the name, the `activeFrom`/`activeTo` calendar days
 * (strictly increasing), then creates the row and its audit fact in one
 * transaction. A position is **deactivated**, never deleted.
 */
export async function registerPosition(
  store: WorkforceStore,
  input: RegisterPositionInput,
): Promise<PositionRecord> {
  if (isBlank(input.code)) {
    throw new DomainError("code is required");
  }
  const code = input.code.trim().toLowerCase();
  if (code.length > MAX_POSITION_TEXT) {
    throw new DomainError("code is too long");
  }
  if (isBlank(input.name)) {
    throw new DomainError("name is required");
  }
  const name = input.name.trim();
  if (name.length > MAX_POSITION_TEXT) {
    throw new DomainError("name is too long");
  }
  if (isBlank(input.activeFrom)) {
    throw new DomainError("activeFrom is required");
  }
  assertOptionalCalendarDate(input.activeFrom, "activeFrom");
  assertOptionalCalendarDate(input.activeTo, "activeTo");
  if (
    input.activeTo !== undefined &&
    input.activeTo !== null &&
    input.activeTo <= input.activeFrom
  ) {
    throw new DomainError("activeTo must be after activeFrom");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.findPositionByCode({ organizationId: input.organizationId, code });
    if (existing !== undefined) {
      throw new DomainError(`position code ${code} already exists in the organization`);
    }
    const position = await tx.createPosition({
      organizationId: input.organizationId,
      code,
      name,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
      createdBy: input.actorId,
    });
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.positionCreated,
      entityType: "position",
      entityId: position.id,
      after: {
        code: position.code,
        name: position.name,
        active_from: position.activeFrom,
        active_to: position.activeTo,
      },
    });
    return position;
  });
}
