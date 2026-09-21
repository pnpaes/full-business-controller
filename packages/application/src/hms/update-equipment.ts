import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import {
  assertMaxLength,
  EQUIPMENT_KIND_MAX,
  EQUIPMENT_NAME_MAX,
  EQUIPMENT_SERIAL_MAX,
} from "./equipment-limits";
import { assertOptionalCalendarDate } from "./register-incident";
import type { EquipmentRecord, HmsStore } from "./types";

export interface UpdateEquipmentInput {
  readonly organizationId: string;
  readonly equipmentId: string;
  /** Non-empty; trimmed. Omitted leaves the name unchanged. */
  readonly name?: string;
  /** Free text; non-blank. Omitted leaves the kind unchanged. */
  readonly kind?: string;
  /** Omitted leaves it unchanged; `null` clears it. */
  readonly serialNo?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly installedAt?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly warrantyUntil?: string | null;
  /** `false` retires the row without deleting it. */
  readonly active?: boolean;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  name: "name",
  kind: "kind",
  serialNo: "serial_no",
  installedAt: "installed_at",
  warrantyUntil: "warranty_until",
  active: "active",
} as const;

/**
 * Amends one equipment row (`HMS-006`, `DEC-092`). The row is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `name`/`kind` must stay
 * non-blank and the calendar dates must be `YYYY-MM-DD`. `code` is the register
 * key and `location_id` is fixed at creation, so neither is patchable. An empty
 * patch is rejected. The update and its audit fact commit or roll back together.
 */
export async function updateEquipment(
  store: HmsStore,
  input: UpdateEquipmentInput,
): Promise<EquipmentRecord> {
  if (isBlank(input.equipmentId)) {
    throw new DomainError("equipmentId is required");
  }

  return store.withTransaction(async (tx) => {
    const equipment = await tx.findEquipment({
      organizationId: input.organizationId,
      equipmentId: input.equipmentId,
    });
    if (equipment === undefined) {
      throw new NotFoundError("equipment not found in organization");
    }

    const mutable: {
      name?: string;
      kind?: string;
      serialNo?: string | null;
      installedAt?: string | null;
      warrantyUntil?: string | null;
      active?: boolean;
    } = {};

    if (input.name !== undefined) {
      if (isBlank(input.name)) {
        throw new DomainError("name is required");
      }
      const name = input.name.trim();
      assertMaxLength(name, EQUIPMENT_NAME_MAX, "name");
      mutable.name = name;
    }
    if (input.kind !== undefined) {
      if (isBlank(input.kind)) {
        throw new DomainError("kind is required");
      }
      const kind = input.kind.trim();
      assertMaxLength(kind, EQUIPMENT_KIND_MAX, "kind");
      mutable.kind = kind;
    }
    if (input.serialNo !== undefined) {
      // Free text with no vocabulary or blank rule: passed through as-is
      // (an explicit `null` clears it), like the register command.
      if (input.serialNo !== null) {
        assertMaxLength(input.serialNo, EQUIPMENT_SERIAL_MAX, "serialNo");
      }
      mutable.serialNo = input.serialNo;
    }
    if (input.installedAt !== undefined) {
      assertOptionalCalendarDate(input.installedAt, "installedAt");
      mutable.installedAt = input.installedAt;
    }
    if (input.warrantyUntil !== undefined) {
      assertOptionalCalendarDate(input.warrantyUntil, "warrantyUntil");
      mutable.warrantyUntil = input.warrantyUntil;
    }
    if (input.active !== undefined) {
      mutable.active = input.active;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateEquipment({
      organizationId: input.organizationId,
      equipmentId: equipment.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("equipment not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = equipment[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.equipmentUpdated,
      entityType: "equipment",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
