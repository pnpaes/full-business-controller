import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import {
  assertMaxLength,
  EQUIPMENT_CODE_MAX,
  EQUIPMENT_KIND_MAX,
  EQUIPMENT_NAME_MAX,
  EQUIPMENT_SERIAL_MAX,
} from "./equipment-limits";
import { assertOptionalCalendarDate } from "./register-incident";
import type { EquipmentRecord, HmsStore } from "./types";

export interface RegisterEquipmentInput {
  readonly organizationId: string;
  readonly locationId: string;
  /** The register key; immutable after creation (unique per organization). */
  readonly code: string;
  readonly name: string;
  /** Free text (`DEC-092` names no vocabulary); must be non-blank. */
  readonly kind: string;
  readonly serialNo?: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly installedAt?: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly warrantyUntil?: string | null;
  /** Defaults `true`; `false` retires a row without deleting it. */
  readonly active?: boolean;
  readonly actorId: string;
}

/**
 * Registers one equipment row (`HMS-006`, `DEC-092`): validates the required
 * `code`/`name`/`kind` text, the location and the optional install/warranty
 * calendar dates, then creates the row (active by default) and its audit fact in
 * one transaction. The create is organization-scoped through
 * `input.organizationId` (`DEC-061`).
 *
 * `kind` is **free text** — `DEC-092` names no vocabulary, so there is no CHECK
 * to mirror and nothing to validate beyond non-blank. The non-empty `code`/`name`
 * checks and the `(organization_id, code)` uniqueness are database-backed
 * (`equipment_code_nonempty_check`, `equipment_name_nonempty_check`,
 * `equipment_organization_id_code_key`), but they are enforced here too so the
 * fake-store unit suite and the API see one error class (`DomainError`) rather
 * than a driver constraint violation; a duplicate code still reaches the
 * database as `23505` because uniqueness cannot be checked from a single row.
 *
 * `assertOptionalCalendarDate` is reused from `register-incident.ts` so the
 * `date` wire form (`YYYY-MM-DD`, rejecting an impossible day) has one
 * implementation.
 */
export async function registerEquipment(
  store: HmsStore,
  input: RegisterEquipmentInput,
): Promise<EquipmentRecord> {
  if (isBlank(input.code)) {
    throw new DomainError("code is required");
  }
  if (isBlank(input.name)) {
    throw new DomainError("name is required");
  }
  if (isBlank(input.locationId)) {
    throw new DomainError("locationId is required");
  }
  if (isBlank(input.kind)) {
    throw new DomainError("kind is required");
  }
  const code = input.code.trim();
  const name = input.name.trim();
  const kind = input.kind.trim();
  assertMaxLength(code, EQUIPMENT_CODE_MAX, "code");
  assertMaxLength(name, EQUIPMENT_NAME_MAX, "name");
  assertMaxLength(kind, EQUIPMENT_KIND_MAX, "kind");
  if (input.serialNo !== undefined && input.serialNo !== null) {
    assertMaxLength(input.serialNo, EQUIPMENT_SERIAL_MAX, "serialNo");
  }
  assertOptionalCalendarDate(input.installedAt, "installedAt");
  assertOptionalCalendarDate(input.warrantyUntil, "warrantyUntil");

  return store.withTransaction(async (tx) => {
    const equipment = await tx.createEquipment({
      organizationId: input.organizationId,
      locationId: input.locationId,
      code,
      name,
      kind,
      serialNo: input.serialNo ?? null,
      installedAt: input.installedAt ?? null,
      warrantyUntil: input.warrantyUntil ?? null,
      active: input.active ?? true,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.equipmentCreated,
      entityType: "equipment",
      entityId: equipment.id,
      after: {
        location_id: equipment.locationId,
        code: equipment.code,
        name: equipment.name,
        kind: equipment.kind,
        serial_no: equipment.serialNo,
        installed_at: equipment.installedAt,
        warranty_until: equipment.warrantyUntil,
        active: equipment.active,
      },
    });

    return equipment;
  });
}
