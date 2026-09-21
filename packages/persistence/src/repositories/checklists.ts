import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { checklistRun, checklistTemplate } from "../schema";

export type ChecklistTemplate = typeof checklistTemplate.$inferSelect;
export type ChecklistRun = typeof checklistRun.$inferSelect;

/*
 * `DEC-091` (`HMS-005`): the IK-mat checklist templates and their runs.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row.
 *
 * A template is versioned by superseding: a revision is a new row whose
 * nullable `supersedes_id` points at the row it replaces, so a run stays pinned
 * to the exact template row it used (`HMS-005`). The vocabulary columns
 * (`category`, `frequency`, `status`) and the jsonb-array shape of
 * `items`/`results` are database-checked, so this layer does not re-validate
 * them; the application validates first so callers see a `DomainError`. Neither
 * table is append-only, so both expose a full update path.
 */

export interface CreateChecklistTemplateInput {
  readonly organizationId: string;
  readonly name: string;
  readonly category: string;
  /** Reuses the shared `CHECK_FREQUENCY` vocabulary (`daily`, `weekly`, ...). */
  readonly frequency: string;
  /** jsonb array; the caller supplies the ordered checklist item list. */
  readonly items: unknown;
  readonly active?: boolean;
  /** The template row this revision replaces (`HMS-005`); null for a first revision. */
  readonly supersedesId?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one checklist template. `organizationId` is supplied by the caller. */
export async function createChecklistTemplate(
  db: Database,
  input: CreateChecklistTemplateInput,
): Promise<ChecklistTemplate> {
  const rows = await db
    .insert(checklistTemplate)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      category: input.category,
      frequency: input.frequency,
      items: input.items,
      ...(input.active === undefined ? {} : { active: input.active }),
      supersedesId: input.supersedesId ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindChecklistTemplateQuery {
  readonly organizationId: string;
  readonly templateId: string;
}

/** One checklist template by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findChecklistTemplate(
  db: Database,
  query: FindChecklistTemplateQuery,
): Promise<ChecklistTemplate | undefined> {
  const rows = await db
    .select()
    .from(checklistTemplate)
    .where(
      and(
        eq(checklistTemplate.id, query.templateId),
        eq(checklistTemplate.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateChecklistTemplatePatch {
  readonly name?: string;
  readonly category?: string;
  readonly frequency?: string;
  /** jsonb array; replaces the whole item list. */
  readonly items?: unknown;
  readonly active?: boolean;
}

export interface UpdateChecklistTemplateInput extends UpdateChecklistTemplatePatch {
  readonly organizationId: string;
  readonly templateId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one checklist template's mutable fields, organization-scoped
 * (`DEC-061`). A field left out of the patch is untouched (drizzle skips
 * `undefined`), while an explicit value replaces it; the audit columns record
 * the amendment. The `supersedes_id` link is immutable after creation — a new
 * revision is a new row (`HMS-005`), not a re-pointing of this one. The id alone
 * cannot address another tenant's row — a missing or cross-organization id
 * returns `undefined`, exactly like `findChecklistTemplate`.
 */
export async function updateChecklistTemplate(
  db: Database,
  input: UpdateChecklistTemplateInput,
): Promise<ChecklistTemplate | undefined> {
  const { organizationId, templateId, actorId, ...patch } = input;
  const rows = await db
    .update(checklistTemplate)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(checklistTemplate.id, templateId),
        eq(checklistTemplate.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListChecklistTemplatesQuery {
  readonly organizationId: string;
  readonly category?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Checklist templates for one organization, name then id, with optional
 * category and active filters. The organization filter is never optional
 * (`DEC-061`), so the caller never sees another tenant's rows. Paging is applied
 * after the ordering.
 */
export async function listChecklistTemplates(
  db: Database,
  query: ListChecklistTemplatesQuery,
): Promise<ChecklistTemplate[]> {
  const statement = db
    .select()
    .from(checklistTemplate)
    .where(
      and(
        eq(checklistTemplate.organizationId, query.organizationId),
        query.category === undefined ? undefined : eq(checklistTemplate.category, query.category),
        query.active === undefined ? undefined : eq(checklistTemplate.active, query.active),
      ),
    )
    .orderBy(asc(checklistTemplate.name), asc(checklistTemplate.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateChecklistRunInput {
  readonly organizationId: string;
  readonly templateId: string;
  readonly locationId: string;
  readonly runAt: Date;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly performedBy: string;
  readonly status: string;
  /** jsonb array of per-item outcomes; the caller supplies it. */
  readonly results: unknown;
  readonly notes?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one checklist run. `organizationId` is supplied by the caller. */
export async function createChecklistRun(
  db: Database,
  input: CreateChecklistRunInput,
): Promise<ChecklistRun> {
  const rows = await db
    .insert(checklistRun)
    .values({
      organizationId: input.organizationId,
      templateId: input.templateId,
      locationId: input.locationId,
      runAt: input.runAt,
      performedBy: input.performedBy,
      status: input.status,
      results: input.results,
      notes: input.notes ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindChecklistRunQuery {
  readonly organizationId: string;
  readonly runId: string;
}

/** One checklist run by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findChecklistRun(
  db: Database,
  query: FindChecklistRunQuery,
): Promise<ChecklistRun | undefined> {
  const rows = await db
    .select()
    .from(checklistRun)
    .where(
      and(eq(checklistRun.id, query.runId), eq(checklistRun.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateChecklistRunPatch {
  readonly status?: string;
  /** jsonb array; replaces the whole results list. */
  readonly results?: unknown;
  readonly notes?: string | null;
}

export interface UpdateChecklistRunInput extends UpdateChecklistRunPatch {
  readonly organizationId: string;
  readonly runId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one checklist run's mutable fields, organization-scoped (`DEC-061`).
 * As with `updateChecklistTemplate`, an omitted field is untouched and an
 * explicit `null` clears a nullable column; a missing or cross-organization id
 * returns `undefined`. The run's provenance (`template_id`, `location_id`,
 * `run_at`, `performed_by`) is immutable after creation, so a completed run
 * keeps the exact template revision it used.
 */
export async function updateChecklistRun(
  db: Database,
  input: UpdateChecklistRunInput,
): Promise<ChecklistRun | undefined> {
  const { organizationId, runId, actorId, ...patch } = input;
  const rows = await db
    .update(checklistRun)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(checklistRun.id, runId), eq(checklistRun.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListChecklistRunsQuery {
  readonly organizationId: string;
  readonly templateId?: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Checklist runs for one organization, newest `run_at` first (then `id`), with
 * optional template/location/status filters. The organization filter is never
 * optional (`DEC-061`). Paging is applied after the ordering.
 */
export async function listChecklistRuns(
  db: Database,
  query: ListChecklistRunsQuery,
): Promise<ChecklistRun[]> {
  const statement = db
    .select()
    .from(checklistRun)
    .where(
      and(
        eq(checklistRun.organizationId, query.organizationId),
        query.templateId === undefined ? undefined : eq(checklistRun.templateId, query.templateId),
        query.locationId === undefined ? undefined : eq(checklistRun.locationId, query.locationId),
        query.status === undefined ? undefined : eq(checklistRun.status, query.status),
      ),
    )
    .orderBy(desc(checklistRun.runAt), desc(checklistRun.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
