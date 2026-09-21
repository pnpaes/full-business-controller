import { DomainError, NotFoundError } from "@aquarela/domain";
import { MAINTENANCE_KIND } from "@aquarela/persistence";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import type { HmsStore, MaintenanceLogRecord } from "./types";

/** The `kind` vocabulary a maintenance log may hold (`MAINTENANCE_KIND`). */
export const MAINTENANCE_KINDS: readonly string[] = MAINTENANCE_KIND;

export interface RecordMaintenanceLogInput {
  readonly organizationId: string;
  readonly equipmentId: string;
  /** One of `MAINTENANCE_KIND` (service/repair/inspection). */
  readonly kind: string;
  /** ISO instant the maintenance was performed at. */
  readonly performedAt: string;
  readonly performedBy: string;
  readonly notes?: string | null;
  /** Optional real FK to `file_object.id`; null when no document is attached. */
  readonly fileObjectId?: string | null;
  readonly actorId: string;
}

/**
 * Records one maintenance-log fact (`HMS-006`, `DEC-092`): validates the
 * equipment id, the `kind` vocabulary, the `performed_at` instant and the
 * operator, then appends the row and its audit fact in one transaction. The
 * create is organization-scoped through `input.organizationId` (`DEC-061`).
 *
 * The equipment is resolved **organization-scoped first** (missing or
 * cross-organization → typed `NotFoundError`) so an unregistered or foreign
 * equipment id cannot leak: the `maintenance_log.equipment_id` FK alone would
 * accept a cross-organization row, and the `0045` guard trigger only fires
 * after the insert. `kind` has a database check too
 * (`maintenance_log_kind_check`), but it is enforced here so the fake-store
 * unit suite and the API see one error class (`DomainError`).
 *
 * This is a fact log: there is no update or delete command and no derived status
 * or completion instant — don't invent one (`DEC-092`). No append-only trigger
 * exists at the database level either, so the create+read restriction lives in
 * the repository, not in the schema.
 */
export async function recordMaintenanceLog(
  store: HmsStore,
  input: RecordMaintenanceLogInput,
): Promise<MaintenanceLogRecord> {
  if (isBlank(input.equipmentId)) {
    throw new DomainError("equipmentId is required");
  }
  const kind = input.kind.trim();
  if (!MAINTENANCE_KINDS.includes(kind)) {
    throw new DomainError(`kind must be one of ${MAINTENANCE_KINDS.join(", ")}`);
  }
  assertIsoInstant(input.performedAt, "performedAt");
  if (isBlank(input.performedBy)) {
    throw new DomainError("performedBy is required");
  }

  return store.withTransaction(async (tx) => {
    const equipment = await tx.findEquipment({
      organizationId: input.organizationId,
      equipmentId: input.equipmentId,
    });
    if (equipment === undefined) {
      throw new NotFoundError("equipment not found in organization");
    }

    const log = await tx.createMaintenanceLog({
      organizationId: input.organizationId,
      equipmentId: equipment.id,
      kind,
      performedAt: input.performedAt,
      performedBy: input.performedBy,
      notes: input.notes ?? null,
      fileObjectId: input.fileObjectId ?? null,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.maintenanceLogRecorded,
      entityType: "maintenance_log",
      entityId: log.id,
      after: {
        equipment_id: log.equipmentId,
        kind: log.kind,
        performed_at: log.performedAt,
        performed_by: log.performedBy,
        notes: log.notes,
        file_object_id: log.fileObjectId,
      },
    });

    return log;
  });
}
