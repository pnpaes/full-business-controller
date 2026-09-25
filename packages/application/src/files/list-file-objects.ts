import type { FileObjectRecord, FileObjectsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_FILE_OBJECT_LIST_LIMIT = 50;

export interface ListFileObjectsQuery {
  readonly organizationId: string;
  /** Polymorphic link type (`'hms_incident'`, `DEC-095`). */
  readonly linkedEntityType: string;
  /** Polymorphic link id (the linked row's id). */
  readonly linkedEntityId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The file objects attached to one entity, newest `uploadedAt` first, as
 * **metadata only** (`DEC-134`). This is the read `DEC-133` recorded as missing:
 * a one-to-many consumer (incident evidence links polymorphically to
 * `hms_incident`, never through a `file_object_id` column) cannot list its
 * attachments without it.
 *
 * The organization filter is never optional, so a caller cannot read another
 * tenant's rows (`DEC-061`); `linkedEntityType` and `linkedEntityId` are both
 * required, because an id alone is ambiguous across entity types. `limit`
 * defaults to `DEFAULT_FILE_OBJECT_LIST_LIMIT` so a caller cannot ask for the
 * whole registry unbounded. The bytes are never read here — download is a
 * separate `readFileObject` through the storage port.
 */
export async function listFileObjects(
  store: FileObjectsStore,
  query: ListFileObjectsQuery,
): Promise<readonly FileObjectRecord[]> {
  return store.listFileObjects({
    organizationId: query.organizationId,
    linkedEntityType: query.linkedEntityType,
    linkedEntityId: query.linkedEntityId,
    limit: query.limit ?? DEFAULT_FILE_OBJECT_LIST_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
