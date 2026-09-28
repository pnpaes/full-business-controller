import { DomainError, NotFoundError } from "@aquarela/domain";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import { MAX_POSITION_TEXT } from "./register-position";
import type { PositionRecord, WorkforceStore } from "./types";

export interface UpdatePositionInput {
  readonly organizationId: string;
  readonly positionId: string;
  /** New code; lower-cased/trimmed and unique per organization. Omitted leaves it. */
  readonly code?: string;
  /** Omitted leaves it unchanged. */
  readonly name?: string;
  /** `date`, `YYYY-MM-DD`. Omitted leaves it unchanged. */
  readonly activeFrom?: string;
  /** `date`, `YYYY-MM-DD`, or null to reactivate. Set to deactivate. */
  readonly activeTo?: string | null;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  code: "code",
  name: "name",
  activeFrom: "active_from",
  activeTo: "active_to",
} as const;

/**
 * Amends one position (`DEC-151`): a rename, a code change (kept unique per
 * organization) or the effective window. **Deactivation is `activeTo`** — there
 * is no delete, so the historical `shift.position_id`/`employee_position`
 * references keep their meaning. The row is loaded organization-scoped first
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`),
 * then the patch is validated and the update plus its audit fact commit or roll
 * back together. An empty patch is rejected.
 */
export async function updatePosition(
  store: WorkforceStore,
  input: UpdatePositionInput,
): Promise<PositionRecord> {
  if (isBlank(input.positionId)) {
    throw new DomainError("positionId is required");
  }

  return store.withTransaction(async (tx) => {
    const position = await tx.findPosition({
      organizationId: input.organizationId,
      positionId: input.positionId.trim(),
    });
    if (position === undefined) {
      throw new NotFoundError("position not found in organization");
    }

    const mutable: {
      code?: string;
      name?: string;
      activeFrom?: string;
      activeTo?: string | null;
    } = {};

    if (input.code !== undefined) {
      if (isBlank(input.code)) {
        throw new DomainError("code is required");
      }
      const code = input.code.trim().toLowerCase();
      if (code.length > MAX_POSITION_TEXT) {
        throw new DomainError("code is too long");
      }
      if (code !== position.code) {
        const clash = await tx.findPositionByCode({
          organizationId: input.organizationId,
          code,
        });
        if (clash !== undefined) {
          throw new DomainError(`position code ${code} already exists in the organization`);
        }
      }
      mutable.code = code;
    }
    if (input.name !== undefined) {
      if (isBlank(input.name)) {
        throw new DomainError("name is required");
      }
      const name = input.name.trim();
      if (name.length > MAX_POSITION_TEXT) {
        throw new DomainError("name is too long");
      }
      mutable.name = name;
    }
    if (input.activeFrom !== undefined) {
      if (isBlank(input.activeFrom)) {
        throw new DomainError("activeFrom is required");
      }
      assertOptionalCalendarDate(input.activeFrom, "activeFrom");
      mutable.activeFrom = input.activeFrom;
    }
    if (input.activeTo !== undefined) {
      assertOptionalCalendarDate(input.activeTo, "activeTo");
      mutable.activeTo = input.activeTo;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const activeFrom = mutable.activeFrom ?? position.activeFrom;
    const activeTo = mutable.activeTo === undefined ? position.activeTo : mutable.activeTo;
    if (activeTo !== null && activeTo <= activeFrom) {
      throw new DomainError("activeTo must be after activeFrom");
    }

    const updated = await tx.updatePosition({
      organizationId: input.organizationId,
      positionId: position.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("position not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = position[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.positionUpdated,
      entityType: "position",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
