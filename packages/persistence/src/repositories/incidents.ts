import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { correctiveAction, hmsIncident } from "../schema";

export type HmsIncident = typeof hmsIncident.$inferSelect;
export type CorrectiveAction = typeof correctiveAction.$inferSelect;

/*
 * `DEC-090` / `DEC-095` (`HMS-003`, `HMS-004`): the HMS incident register and
 * its corrective actions.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on
 * `id` **and** `organization_id`, and a scoped miss returns `undefined` rather
 * than surfacing another tenant's row.
 *
 * The vocabulary columns (`category`, `severity`, `status`) and the
 * `involves_personal_data` flag are database-checked, so this layer does not
 * re-validate them; the application validates first so callers see a
 * `DomainError`. Neither table is append-only, so both expose a full
 * update path. Evidence attaches through the polymorphic `file_object` link,
 * not a column here.
 */

export interface CreateIncidentInput {
  readonly organizationId: string;
  readonly locationId: string;
  readonly category: string;
  readonly severity: string;
  readonly occurredAt: Date;
  readonly reportedAt: Date;
  readonly reportedBy: string;
  readonly ownerId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  /** `date` column; the caller supplies an ISO day (`YYYY-MM-DD`). */
  readonly dueDate?: string | null;
  readonly involvesPersonalData: boolean;
  readonly status: string;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one incident. `organizationId` is supplied by the caller. */
export async function createIncident(
  db: Database,
  input: CreateIncidentInput,
): Promise<HmsIncident> {
  const rows = await db
    .insert(hmsIncident)
    .values({
      organizationId: input.organizationId,
      locationId: input.locationId,
      category: input.category,
      severity: input.severity,
      occurredAt: input.occurredAt,
      reportedAt: input.reportedAt,
      reportedBy: input.reportedBy,
      ownerId: input.ownerId ?? null,
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      involvesPersonalData: input.involvesPersonalData,
      status: input.status,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindIncidentQuery {
  readonly organizationId: string;
  readonly incidentId: string;
}

/** One incident by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findIncident(
  db: Database,
  query: FindIncidentQuery,
): Promise<HmsIncident | undefined> {
  const rows = await db
    .select()
    .from(hmsIncident)
    .where(
      and(
        eq(hmsIncident.id, query.incidentId),
        eq(hmsIncident.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateIncidentPatch {
  readonly locationId?: string;
  readonly category?: string;
  readonly severity?: string;
  readonly occurredAt?: Date;
  readonly reportedAt?: Date;
  readonly reportedBy?: string;
  readonly ownerId?: string | null;
  readonly title?: string;
  readonly description?: string | null;
  /** `date` column; an ISO day (`YYYY-MM-DD`) or null to clear it. */
  readonly dueDate?: string | null;
  readonly involvesPersonalData?: boolean;
  readonly status?: string;
  readonly closedAt?: Date | null;
}

export interface UpdateIncidentInput extends UpdateIncidentPatch {
  readonly organizationId: string;
  readonly incidentId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one incident's mutable fields, organization-scoped (`DEC-061`). A
 * field left out of the patch is untouched (drizzle skips `undefined`), while an
 * explicit `null` clears a nullable column; the audit columns record the
 * amendment. The id alone cannot address another tenant's row — a missing or
 * cross-organization id returns `undefined`, exactly like `findIncident`.
 */
export async function updateIncident(
  db: Database,
  input: UpdateIncidentInput,
): Promise<HmsIncident | undefined> {
  const { organizationId, incidentId, actorId, ...patch } = input;
  const rows = await db
    .update(hmsIncident)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(hmsIncident.id, incidentId), eq(hmsIncident.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListIncidentsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Incidents for one organization, newest `occurred_at` first (then `id`), with
 * optional status and location filters. The organization filter is never
 * optional (`DEC-061`), so the caller never sees another tenant's rows. Paging
 * is applied after the ordering.
 */
export async function listIncidents(
  db: Database,
  query: ListIncidentsQuery,
): Promise<HmsIncident[]> {
  const statement = db
    .select()
    .from(hmsIncident)
    .where(
      and(
        eq(hmsIncident.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(hmsIncident.status, query.status),
        query.locationId === undefined ? undefined : eq(hmsIncident.locationId, query.locationId),
      ),
    )
    .orderBy(desc(hmsIncident.occurredAt), desc(hmsIncident.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateCorrectiveActionInput {
  readonly organizationId: string;
  readonly incidentId?: string | null;
  readonly monitoringReadingId?: string | null;
  readonly description: string;
  readonly ownerId?: string | null;
  /** `date` column; the caller supplies an ISO day (`YYYY-MM-DD`). */
  readonly dueDate?: string | null;
  readonly status: string;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Creates one corrective action. `incidentId` and `monitoringReadingId` are both
 * optional and independent: an action may hang off an incident, a reading, or
 * neither.
 */
export async function createCorrectiveAction(
  db: Database,
  input: CreateCorrectiveActionInput,
): Promise<CorrectiveAction> {
  const rows = await db
    .insert(correctiveAction)
    .values({
      organizationId: input.organizationId,
      incidentId: input.incidentId ?? null,
      monitoringReadingId: input.monitoringReadingId ?? null,
      description: input.description,
      ownerId: input.ownerId ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindCorrectiveActionQuery {
  readonly organizationId: string;
  readonly correctiveActionId: string;
}

/** One corrective action by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findCorrectiveAction(
  db: Database,
  query: FindCorrectiveActionQuery,
): Promise<CorrectiveAction | undefined> {
  const rows = await db
    .select()
    .from(correctiveAction)
    .where(
      and(
        eq(correctiveAction.id, query.correctiveActionId),
        eq(correctiveAction.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateCorrectiveActionPatch {
  readonly incidentId?: string | null;
  readonly monitoringReadingId?: string | null;
  readonly description?: string;
  readonly ownerId?: string | null;
  /** `date` column; an ISO day (`YYYY-MM-DD`) or null to clear it. */
  readonly dueDate?: string | null;
  readonly status?: string;
  readonly completedAt?: Date | null;
  readonly verifiedBy?: string | null;
  readonly verifiedAt?: Date | null;
}

export interface UpdateCorrectiveActionInput extends UpdateCorrectiveActionPatch {
  readonly organizationId: string;
  readonly correctiveActionId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one corrective action's mutable fields, organization-scoped
 * (`DEC-061`). As with `updateIncident`, an omitted field is untouched and an
 * explicit `null` clears a nullable column; a missing or cross-organization id
 * returns `undefined`.
 */
export async function updateCorrectiveAction(
  db: Database,
  input: UpdateCorrectiveActionInput,
): Promise<CorrectiveAction | undefined> {
  const { organizationId, correctiveActionId, actorId, ...patch } = input;
  const rows = await db
    .update(correctiveAction)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(correctiveAction.id, correctiveActionId),
        eq(correctiveAction.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListCorrectiveActionsQuery {
  readonly organizationId: string;
  readonly incidentId?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Corrective actions for one organization, earliest `due_date` first (then
 * `id`; a null due date sorts last), with optional incident/status/owner
 * filters. The organization filter is never optional (`DEC-061`). Paging is
 * applied after the ordering.
 */
export async function listCorrectiveActions(
  db: Database,
  query: ListCorrectiveActionsQuery,
): Promise<CorrectiveAction[]> {
  const statement = db
    .select()
    .from(correctiveAction)
    .where(
      and(
        eq(correctiveAction.organizationId, query.organizationId),
        query.incidentId === undefined
          ? undefined
          : eq(correctiveAction.incidentId, query.incidentId),
        query.status === undefined ? undefined : eq(correctiveAction.status, query.status),
        query.ownerId === undefined ? undefined : eq(correctiveAction.ownerId, query.ownerId),
      ),
    )
    .orderBy(asc(correctiveAction.dueDate), asc(correctiveAction.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
