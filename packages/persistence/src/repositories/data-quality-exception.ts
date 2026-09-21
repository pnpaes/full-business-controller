import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { dataQualityException } from "../schema";

export type DataQualityException = typeof dataQualityException.$inferSelect;
export type NewDataQualityException = typeof dataQualityException.$inferInsert;

/*
 * `DEC-080` (`DATA_DICTIONARY` §9, `DQ-001`): the data-quality exception store
 * (`data_quality_exception`, migration `0030`).
 *
 * The table carries `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`) — as is the create
 * (`input.organizationId`). `entity_id` is a polymorphic plain uuid (no FK) and
 * `rule_code` is provisional free text; `severity`/`status` are constrained by
 * the `exception_severity`/`exception_status` vocabularies in the schema. The
 * first producer is the transfer receive discrepancy; the count- and
 * yield-variance producers landed 2026-09-21 (`DEC-084`) — `count_variance`
 * from count approval and `yield_variance` from batch completion, recorded
 * unconditionally pending the FIN tolerance thresholds.
 */

export async function createDataQualityException(
  db: Database,
  input: NewDataQualityException,
): Promise<DataQualityException> {
  const rows = await db.insert(dataQualityException).values(input).returning();
  return rows[0]!;
}

export interface FindDataQualityExceptionQuery {
  readonly organizationId: string;
  readonly exceptionId: string;
}

/** One exception by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findDataQualityException(
  db: Database,
  query: FindDataQualityExceptionQuery,
): Promise<DataQualityException | undefined> {
  const rows = await db
    .select()
    .from(dataQualityException)
    .where(
      and(
        eq(dataQualityException.id, query.exceptionId),
        eq(dataQualityException.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListDataQualityExceptionsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly severity?: string;
  readonly entityType?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Exceptions for one organization, newest `detected_at` first (then `id`), with
 * optional status/severity/entity-type filters. Every filter is optional except
 * the organization, so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listDataQualityExceptions(
  db: Database,
  query: ListDataQualityExceptionsQuery,
): Promise<DataQualityException[]> {
  const statement = db
    .select()
    .from(dataQualityException)
    .where(
      and(
        eq(dataQualityException.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(dataQualityException.status, query.status),
        query.severity === undefined
          ? undefined
          : eq(dataQualityException.severity, query.severity),
        query.entityType === undefined
          ? undefined
          : eq(dataQualityException.entityType, query.entityType),
      ),
    )
    .orderBy(desc(dataQualityException.detectedAt), desc(dataQualityException.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface DataQualityExceptionPatch {
  status?: string;
  resolution?: string | null;
  ownerId?: string | null;
  /** `date`, `yyyy-mm-dd`. */
  dueDate?: string | null;
  updatedAt?: Date;
}

/**
 * Narrow update for the exception lifecycle: status plus the resolution trail
 * (`resolution`, `owner_id`, `due_date`). The schema's
 * `data_quality_exception_status_check` still governs which statuses are legal.
 * The id is the only key, matching `updateStockCount`; the create/find/list
 * paths carry the organization.
 */
export async function updateDataQualityException(
  db: Database,
  id: string,
  patch: DataQualityExceptionPatch,
): Promise<DataQualityException | undefined> {
  const rows = await db
    .update(dataQualityException)
    .set(patch)
    .where(eq(dataQualityException.id, id))
    .returning();
  return rows[0];
}
