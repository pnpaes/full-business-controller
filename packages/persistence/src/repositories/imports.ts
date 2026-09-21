import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../client";
import {
  externalMapping,
  importDisposition,
  importProfile,
  importRun,
  importStagingRow,
} from "../schema";

export type ImportRun = typeof importRun.$inferSelect;
export type NewImportRun = typeof importRun.$inferInsert;
export type ImportProfile = typeof importProfile.$inferSelect;
export type NewImportProfile = typeof importProfile.$inferInsert;
export type ImportStagingRow = typeof importStagingRow.$inferSelect;
export type NewImportStagingRow = typeof importStagingRow.$inferInsert;
export type ImportDisposition = typeof importDisposition.$inferSelect;
export type NewImportDisposition = typeof importDisposition.$inferInsert;
export type ExternalMapping = typeof externalMapping.$inferSelect;
export type NewExternalMapping = typeof externalMapping.$inferInsert;

/*
 * Slice-11 import-framework reads/writes (`SALE-002`, `SALE-004`, `SALE-007`,
 * `SALE-008`; `DEC-033`, `DEC-035`).
 *
 * `import_run` carries `organization_id` directly, so its reads are
 * organization-scoped (`DEC-061`). `import_staging_row` has no organization
 * column of its own, so its reads are scoped through the parent `import_run`
 * join (mirrors `listStockCountLines`). The `DEC-083` `import_disposition`
 * likewise carries no organization column, so its reads are scoped through the
 * `import_staging_row` → `import_run` join. `external_mapping` carries
 * `organization_id` directly; its natural key
 * `(source_system, entity_type, external_id, effective_from)` is the
 * `findOrCreate` idempotency path. `import_profile` (`DEC-081`, migration
 * `0031`) also carries `organization_id` directly and is read by
 * `(organization_id, id)` or `(organization_id, source)`; resolving a profile
 * onto a run is the application's job, so this file only creates and reads
 * profiles.
 *
 * This slice posts nothing: `createImportRun`/`updateImportRun` never write a
 * `stock_movement` or a sales fact. The posting step is row 12 and owner-gated
 * on `ADR-0008` (open point (c)).
 */

export async function createImportRun(db: Database, input: NewImportRun): Promise<ImportRun> {
  const rows = await db.insert(importRun).values(input).returning();
  return rows[0]!;
}

export interface FindImportRunQuery {
  readonly organizationId: string;
  readonly importRunId: string;
}

/** One import run by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findImportRun(
  db: Database,
  query: FindImportRunQuery,
): Promise<ImportRun | undefined> {
  const rows = await db
    .select()
    .from(importRun)
    .where(
      and(eq(importRun.id, query.importRunId), eq(importRun.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface ListImportRunsQuery {
  readonly organizationId: string;
  readonly source?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Import runs for one organization, newest created first (`created_at`, then
 * `id`), with optional source/status filters. Every filter is optional except
 * the organization, so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listImportRuns(
  db: Database,
  query: ListImportRunsQuery,
): Promise<ImportRun[]> {
  const statement = db
    .select()
    .from(importRun)
    .where(
      and(
        eq(importRun.organizationId, query.organizationId),
        query.source === undefined ? undefined : eq(importRun.source, query.source),
        query.status === undefined ? undefined : eq(importRun.status, query.status),
      ),
    )
    .orderBy(desc(importRun.createdAt), desc(importRun.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface ImportRunPatch {
  status?: string;
  rowCounts?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  updatedAt?: Date;
}

/**
 * Narrow, additive update for the import lifecycle (`uploaded` → `posted`):
 * status plus the `row_counts`/`diagnostics` facts. The schema's
 * `import_run_status_check` still governs which statuses are legal. Posting the
 * staged rows to sales is row 12 and owner-gated on `ADR-0008`; this only
 * records the run's own progress.
 */
export async function updateImportRun(
  db: Database,
  id: string,
  patch: ImportRunPatch,
): Promise<ImportRun | undefined> {
  const rows = await db.update(importRun).set(patch).where(eq(importRun.id, id)).returning();
  return rows[0];
}

/**
 * Creates the per-source `import_profile` (`DEC-081`). `posting_policy` defaults
 * to `allow_partial` and `validation_rules` to `{}` at the schema level; the
 * `(organization_id, source)` unique key makes a second profile for the same
 * source fail rather than silently shadow the first.
 */
export async function createImportProfile(
  db: Database,
  input: NewImportProfile,
): Promise<ImportProfile> {
  const rows = await db.insert(importProfile).values(input).returning();
  return rows[0]!;
}

/**
 * Exactly one of `importProfileId`/`source` identifies the profile, so supplying
 * both (or neither) is a compile error.
 */
export type FindImportProfileQuery =
  | {
      readonly organizationId: string;
      readonly importProfileId: string;
      readonly source?: undefined;
    }
  | {
      readonly organizationId: string;
      readonly source: string;
      readonly importProfileId?: undefined;
    };

/**
 * One profile by id or by `source`, always organization-scoped (`DEC-061`), or
 * `undefined`. The `(organization_id, source)` unique key keeps the source
 * lookup unambiguous.
 */
export async function findImportProfile(
  db: Database,
  query: FindImportProfileQuery,
): Promise<ImportProfile | undefined> {
  const predicate =
    query.importProfileId !== undefined
      ? eq(importProfile.id, query.importProfileId)
      : eq(importProfile.source, query.source);
  const rows = await db
    .select()
    .from(importProfile)
    .where(and(eq(importProfile.organizationId, query.organizationId), predicate))
    .limit(1);
  return rows[0];
}

export async function createImportStagingRow(
  db: Database,
  input: NewImportStagingRow,
): Promise<ImportStagingRow> {
  const rows = await db.insert(importStagingRow).values(input).returning();
  return rows[0]!;
}

export interface ListImportStagingRowsQuery {
  readonly organizationId: string;
  readonly importRunId: string;
}

/**
 * Staging rows of one import run, in source order (`source_row_no`),
 * organization-scoped through the parent run.
 */
export async function listImportStagingRows(
  db: Database,
  query: ListImportStagingRowsQuery,
): Promise<ImportStagingRow[]> {
  const rows = await db
    .select({ row: importStagingRow })
    .from(importStagingRow)
    .innerJoin(importRun, eq(importRun.id, importStagingRow.importRunId))
    .where(
      and(
        eq(importStagingRow.importRunId, query.importRunId),
        eq(importRun.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(importStagingRow.sourceRowNo));
  return rows.map((row) => row.row);
}

export interface ImportStagingRowPatch {
  normalized?: unknown;
  mappingState?: string;
  errorCode?: string | null;
  linkedSalesLineId?: string | null;
}

/** Records the mapped/normalized shape and the row's mapping state. */
export async function updateImportStagingRow(
  db: Database,
  id: string,
  patch: ImportStagingRowPatch,
): Promise<ImportStagingRow | undefined> {
  const rows = await db
    .update(importStagingRow)
    .set(patch)
    .where(eq(importStagingRow.id, id))
    .returning();
  return rows[0];
}

/** A disposition joined to its staging row (for `sourceRowNo`/`importRunId`). */
export interface ImportDispositionListItem extends ImportDisposition {
  readonly importRunId: string;
  readonly sourceRowNo: number;
}

export interface ImportDispositionCount {
  readonly importRunId: string;
  readonly count: number;
}

/**
 * Creates the one disposition for a staging row. `undefined` when that row
 * already has one: `ON CONFLICT DO NOTHING` on `import_disposition_staging_row_key`
 * makes the unique key the guard, safe against concurrent double-disposition.
 */
export async function createImportDisposition(
  db: Database,
  input: NewImportDisposition,
): Promise<ImportDisposition | undefined> {
  const rows = await db.insert(importDisposition).values(input).onConflictDoNothing().returning();
  return rows[0];
}

export interface ListImportDispositionsQuery {
  readonly organizationId: string;
  readonly importRunId: string;
}

/** One run's dispositions in source order, organization-scoped through the run join. */
export async function listImportDispositions(
  db: Database,
  query: ListImportDispositionsQuery,
): Promise<ImportDispositionListItem[]> {
  const rows = await db
    .select({
      disposition: importDisposition,
      importRunId: importStagingRow.importRunId,
      sourceRowNo: importStagingRow.sourceRowNo,
    })
    .from(importDisposition)
    .innerJoin(importStagingRow, eq(importStagingRow.id, importDisposition.importStagingRowId))
    .innerJoin(importRun, eq(importRun.id, importStagingRow.importRunId))
    .where(
      and(
        eq(importStagingRow.importRunId, query.importRunId),
        eq(importRun.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(importStagingRow.sourceRowNo));
  return rows.map((row) => ({
    ...row.disposition,
    importRunId: row.importRunId,
    sourceRowNo: row.sourceRowNo,
  }));
}

export interface CountImportDispositionsByRunQuery {
  readonly organizationId: string;
  readonly importRunIds: readonly string[];
}

/** Disposition counts for a set of runs (one grouped query, organization-scoped). */
export async function countImportDispositionsByRun(
  db: Database,
  query: CountImportDispositionsByRunQuery,
): Promise<ImportDispositionCount[]> {
  if (query.importRunIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      importRunId: importStagingRow.importRunId,
      count: sql<number>`count(${importDisposition.id})::int`,
    })
    .from(importDisposition)
    .innerJoin(importStagingRow, eq(importStagingRow.id, importDisposition.importStagingRowId))
    .innerJoin(importRun, eq(importRun.id, importStagingRow.importRunId))
    .where(
      and(
        inArray(importStagingRow.importRunId, [...query.importRunIds]),
        eq(importRun.organizationId, query.organizationId),
      ),
    )
    .groupBy(importStagingRow.importRunId);
  return rows.map((row) => ({ importRunId: row.importRunId, count: row.count }));
}

/** The natural key of an external mapping. */
export interface ExternalMappingKey {
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly externalId: string;
  readonly effectiveFrom: Date;
}

/**
 * Create-or-find an external mapping by its natural key `(source_system,
 * entity_type, external_id, effective_from)`, safe against the create/find
 * race: `INSERT … ON CONFLICT DO NOTHING` then `SELECT` the surviving row. The
 * select is organization-scoped, so a key already held by another organization
 * surfaces as the explicit error below rather than leaking that row.
 */
export async function findOrCreateExternalMapping(
  db: Database,
  input: NewExternalMapping,
): Promise<ExternalMapping> {
  const inserted = await db.insert(externalMapping).values(input).onConflictDoNothing().returning();
  const created = inserted[0];
  if (created !== undefined) {
    return created;
  }

  const rows = await db
    .select()
    .from(externalMapping)
    .where(
      and(
        eq(externalMapping.organizationId, input.organizationId),
        eq(externalMapping.sourceSystem, input.sourceSystem),
        eq(externalMapping.entityType, input.entityType),
        eq(externalMapping.externalId, input.externalId),
        eq(externalMapping.effectiveFrom, input.effectiveFrom),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "external_mapping row missing after findOrCreateExternalMapping: the conflicting unique " +
        "index and the lookup key disagree (or the key belongs to another organization)",
    );
  }
  return row;
}

export interface FindExternalMappingQuery {
  readonly organizationId: string;
  readonly externalMappingId: string;
}

/** One mapping by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findExternalMapping(
  db: Database,
  query: FindExternalMappingQuery,
): Promise<ExternalMapping | undefined> {
  const rows = await db
    .select()
    .from(externalMapping)
    .where(
      and(
        eq(externalMapping.id, query.externalMappingId),
        eq(externalMapping.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListExternalMappingsQuery {
  readonly organizationId: string;
  readonly sourceSystem?: string;
  readonly entityType?: string;
  readonly externalId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Mappings for one organization, newest effective window first
 * (`effective_from`, then `id`), with optional source/entity/external-id
 * filters. Every filter is optional except the organization, so the caller
 * never sees another tenant's rows. Paging is applied after the ordering.
 */
export async function listExternalMappings(
  db: Database,
  query: ListExternalMappingsQuery,
): Promise<ExternalMapping[]> {
  const statement = db
    .select()
    .from(externalMapping)
    .where(
      and(
        eq(externalMapping.organizationId, query.organizationId),
        query.sourceSystem === undefined
          ? undefined
          : eq(externalMapping.sourceSystem, query.sourceSystem),
        query.entityType === undefined
          ? undefined
          : eq(externalMapping.entityType, query.entityType),
        query.externalId === undefined
          ? undefined
          : eq(externalMapping.externalId, query.externalId),
      ),
    )
    .orderBy(desc(externalMapping.effectiveFrom), desc(externalMapping.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
