import { DomainError } from "@aquarela/domain";

import { sha256Hex } from "./checksum";
import type { FileStoragePort } from "./file-storage";
import type { FileObjectRecord, FileObjectsStore } from "./types";

export interface ReadFileObjectQuery {
  readonly organizationId: string;
  readonly fileObjectId: string;
}

export interface StoredFile {
  readonly metadata: FileObjectRecord;
  readonly bytes: Uint8Array;
}

/**
 * Reads one stored file's bytes with its metadata (`DEC-132`).
 *
 * The metadata row is resolved **organization-scoped** (`DEC-061`) first, so a
 * missing id and another tenant's id are indistinguishable (`undefined`). When
 * the row exists but the bytes do not, that is an inconsistency rather than a
 * miss and raises a `DomainError`; a stored checksum that does not match the
 * bytes also raises, so a corrupted or swapped object cannot be served as the
 * file the metadata describes.
 */
export async function readFileObject(
  store: FileObjectsStore,
  storage: FileStoragePort,
  query: ReadFileObjectQuery,
): Promise<StoredFile | undefined> {
  const metadata = await store.findFileObject({
    organizationId: query.organizationId,
    fileObjectId: query.fileObjectId,
  });
  if (metadata === undefined) {
    return undefined;
  }

  const bytes = await storage.get(metadata.storageKey);
  if (bytes === undefined) {
    throw new DomainError("stored file bytes are missing for this file object");
  }
  if (sha256Hex(bytes) !== metadata.checksumSha256) {
    throw new DomainError("stored file checksum does not match its metadata");
  }

  return { metadata, bytes };
}
