import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { equipment, maintenanceLog } from "../schema";

export type Equipment = typeof equipment.$inferSelect;
export type MaintenanceLog = typeof maintenanceLog.$inferSelect;

/*
 * `DEC-092` (`HMS-006`): the equipment register and its maintenance log.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row.
 *
 * `equipment` is a mutable register: `code` is immutable once assigned (the
 * `(organization_id, code)` key it anchors must not move under a caller), while
 * the descriptive fields and `active` are patchable (`updateEquipment`).
 * `maintenance_log` is a fact log: this layer exposes **create + read only** —
 * no update or delete command — because `DEC-092` records it as a fact, and
 * neither table is append-only (no trigger), so the restriction is the
 * repository's, not the database's.
 *
 * The vocabulary column (`maintenance_log.kind`), the non-empty `code`/`name`
 * checks and the `(organization_id, code)` uniqueness are database-backed, so
 * this layer does not re-validate them; the application validates first so
 * callers see a `DomainError`.
 */

export interface CreateEquipmentInput {
  readonly organizationId: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  /** Free text (`DEC-092` names no vocabulary); no CHECK backs it. */
  readonly kind: string;
  readonly serialNo?: string | null;
  /** `date`; crosses this layer as a `YYYY-MM-DD` string. */
  readonly installedAt?: string | null;
  /** `date`; crosses this layer as a `YYYY-MM-DD` string. */
  readonly warrantyUntil?: string | null;
  readonly active?: boolean;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one equipment register row. `organizationId` is supplied by the caller. */
export async function createEquipment(
  db: Database,
  input: CreateEquipmentInput,
): Promise<Equipment> {
  const rows = await db
    .insert(equipment)
    .values({
      organizationId: input.organizationId,
      locationId: input.locationId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      serialNo: input.serialNo ?? null,
      installedAt: input.installedAt ?? null,
      warrantyUntil: input.warrantyUntil ?? null,
      ...(input.active === undefined ? {} : { active: input.active }),
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindEquipmentQuery {
  readonly organizationId: string;
  readonly equipmentId: string;
}

/** One equipment row by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findEquipment(
  db: Database,
  query: FindEquipmentQuery,
): Promise<Equipment | undefined> {
  const rows = await db
    .select()
    .from(equipment)
    .where(
      and(eq(equipment.id, query.equipmentId), eq(equipment.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateEquipmentPatch {
  readonly name?: string;
  readonly kind?: string;
  readonly serialNo?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null` to clear it. */
  readonly installedAt?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null` to clear it. */
  readonly warrantyUntil?: string | null;
  readonly active?: boolean;
}

export interface UpdateEquipmentInput extends UpdateEquipmentPatch {
  readonly organizationId: string;
  readonly equipmentId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one equipment row's mutable fields, organization-scoped (`DEC-061`).
 * A field left out of the patch is untouched (drizzle skips `undefined`), while
 * an explicit value replaces it and an explicit `null` clears a nullable column;
 * the audit columns record the amendment. `code` and `locationId` are immutable
 * after creation, so the `(organization_id, code)` key cannot move under a
 * caller. The id alone cannot address another tenant's row — a missing or
 * cross-organization id returns `undefined`, exactly like `findEquipment`.
 */
export async function updateEquipment(
  db: Database,
  input: UpdateEquipmentInput,
): Promise<Equipment | undefined> {
  const { organizationId, equipmentId, actorId, ...patch } = input;
  const rows = await db
    .update(equipment)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListEquipmentQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly kind?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Equipment rows for one organization, ordered by `code` (then `id`), with
 * optional location, kind and active filters. The organization filter is never
 * optional (`DEC-061`), so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listEquipment(db: Database, query: ListEquipmentQuery): Promise<Equipment[]> {
  const statement = db
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(equipment.locationId, query.locationId),
        query.kind === undefined ? undefined : eq(equipment.kind, query.kind),
        query.active === undefined ? undefined : eq(equipment.active, query.active),
      ),
    )
    .orderBy(asc(equipment.code), asc(equipment.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateMaintenanceLogInput {
  readonly organizationId: string;
  /** NOT NULL: an unregistered-equipment maintenance is rejected by the FK. */
  readonly equipmentId: string;
  /** Checked against the `MAINTENANCE_KIND` vocabulary (service/repair/inspection). */
  readonly kind: string;
  readonly performedAt: Date;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly performedBy: string;
  readonly notes?: string | null;
  /** Optional real FK to `file_object.id`; null when no document is attached. */
  readonly fileObjectId?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Appends one maintenance-log fact. `organizationId` is supplied by the caller. */
export async function createMaintenanceLog(
  db: Database,
  input: CreateMaintenanceLogInput,
): Promise<MaintenanceLog> {
  const rows = await db
    .insert(maintenanceLog)
    .values({
      organizationId: input.organizationId,
      equipmentId: input.equipmentId,
      kind: input.kind,
      performedAt: input.performedAt,
      performedBy: input.performedBy,
      notes: input.notes ?? null,
      fileObjectId: input.fileObjectId ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindMaintenanceLogQuery {
  readonly organizationId: string;
  readonly maintenanceLogId: string;
}

/** One maintenance log by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findMaintenanceLog(
  db: Database,
  query: FindMaintenanceLogQuery,
): Promise<MaintenanceLog | undefined> {
  const rows = await db
    .select()
    .from(maintenanceLog)
    .where(
      and(
        eq(maintenanceLog.id, query.maintenanceLogId),
        eq(maintenanceLog.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListMaintenanceLogsQuery {
  readonly organizationId: string;
  readonly equipmentId?: string;
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Maintenance logs for one organization, newest `performed_at` first (then
 * `id`), with optional equipment and kind filters. The organization filter is
 * never optional (`DEC-061`). Paging is applied after the ordering.
 */
export async function listMaintenanceLogs(
  db: Database,
  query: ListMaintenanceLogsQuery,
): Promise<MaintenanceLog[]> {
  const statement = db
    .select()
    .from(maintenanceLog)
    .where(
      and(
        eq(maintenanceLog.organizationId, query.organizationId),
        query.equipmentId === undefined
          ? undefined
          : eq(maintenanceLog.equipmentId, query.equipmentId),
        query.kind === undefined ? undefined : eq(maintenanceLog.kind, query.kind),
      ),
    )
    .orderBy(desc(maintenanceLog.performedAt), desc(maintenanceLog.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
