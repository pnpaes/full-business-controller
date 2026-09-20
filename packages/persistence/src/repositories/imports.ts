import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { externalMapping, importRun, importStagingRow } from "../schema";

export type ImportRun = typeof importRun.$inferSelect;
export type NewImportRun = typeof importRun.$inferInsert;
export type ImportStagingRow = typeof importStagingRow.$inferSelect;
export type NewImportStagingRow = typeof importStagingRow.$inferInsert;
export type ExternalMapping = typeof externalMapping.$inferSelect;
export type NewExternalMapping = typeof externalMapping.$inferInsert;

/*
 * Slice-11 import-framework reads/writes (`SALE-002`, `SALE-004`, `SALE-007`,
 * `SALE-008`; `DEC-033`, `DEC-035`).
 *
 * `import_run` carries `organization_id` directly, so its reads are
 * organization-scoped (`DEC-061`). `import_staging_row` has no organization
 * column of its own, so its reads are scoped through the parent `import_run`
 * join (mirrors `listStockCountLines`). `external_mapping` carries
 * `organization_id` directly; its natural key
 * `(source_system, entity_type, external_id, effective_from)` is the
 * `findOrCreate` idempotency path (open point (a) in `schema/sales.ts`: there is
 * no import-profile table, so nothing here resolves a profile).
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
