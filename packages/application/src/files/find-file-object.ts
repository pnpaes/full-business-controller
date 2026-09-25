import type { FileObjectRecord, FileObjectsStore } from "./types";

export interface FindFileObjectQuery {
  readonly organizationId: string;
  readonly fileObjectId: string;
}

/**
 * One file object's metadata by id, organization-scoped (`DEC-061`), or
 * `undefined`. A missing id and another tenant's id are indistinguishable, so a
 * caller cannot probe for the existence of a file outside its organization. This
 * reads metadata only; the bytes come from `readFileObject` through the storage
 * port.
 */
export async function findFileObject(
  store: FileObjectsStore,
  query: FindFileObjectQuery,
): Promise<FileObjectRecord | undefined> {
  return store.findFileObject({
    organizationId: query.organizationId,
    fileObjectId: query.fileObjectId,
  });
}
