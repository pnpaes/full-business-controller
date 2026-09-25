import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { fileObject } from "../schema";

export type FileObject = typeof fileObject.$inferSelect;
export type NewFileObject = typeof fileObject.$inferInsert;

/*
 * `ADR-0006`/`DEC-085` (row-11 import-framework point 6): the storage-object
 * registry (`file_object`, migration `0035`).
 *
 * The table carries `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`) — as is the create
 * (`input.organizationId`). `(linked_entity_type, linked_entity_id)` is a
 * polymorphic target with no FK, `uploaded_by` is a plain uuid (the `app_user`
 * FK is deferred) and `retention_policy` is provisional free text. No storage
 * client, signed URLs or retention enforcement live here: this is metadata only.
 * `import_run.file_object_id` is the first consumer (the FK + org guard are
 * migrations `0035`/`0036`).
 */

export async function createFileObject(db: Database, input: NewFileObject): Promise<FileObject> {
  const rows = await db.insert(fileObject).values(input).returning();
  return rows[0]!;
}

export interface FindFileObjectQuery {
  readonly organizationId: string;
  readonly fileObjectId: string;
}

/** One file object by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findFileObject(
  db: Database,
  query: FindFileObjectQuery,
): Promise<FileObject | undefined> {
  const rows = await db
    .select()
    .from(fileObject)
    .where(
      and(
        eq(fileObject.id, query.fileObjectId),
        eq(fileObject.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListFileObjectsQuery {
  readonly organizationId: string;
  readonly linkedEntityType?: string;
  /**
   * Optional polymorphic link id. Filtering by id alone is meaningless without
   * a type (ids are not unique across entity types), so callers supply both
   * (`DEC-134`); either may be omitted to leave that side unfiltered.
   */
  readonly linkedEntityId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * File objects for one organization, newest `uploaded_at` first (then `id`),
 * with optional linked-entity filters. The organization filter is never
 * optional, so the caller never sees another tenant's rows. Paging is applied
 * after the ordering.
 */
export async function listFileObjects(
  db: Database,
  query: ListFileObjectsQuery,
): Promise<FileObject[]> {
  const statement = db
    .select()
    .from(fileObject)
    .where(
      and(
        eq(fileObject.organizationId, query.organizationId),
        query.linkedEntityType === undefined
          ? undefined
          : eq(fileObject.linkedEntityType, query.linkedEntityType),
        query.linkedEntityId === undefined
          ? undefined
          : eq(fileObject.linkedEntityId, query.linkedEntityId),
      ),
    )
    .orderBy(desc(fileObject.uploadedAt), desc(fileObject.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
