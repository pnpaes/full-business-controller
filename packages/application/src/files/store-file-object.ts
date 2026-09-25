import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { FILE_AUDIT_ACTIONS } from "./actions";
import type { FileStoragePort } from "./file-storage";
import { buildStorageKey } from "./storage-key";
import type { FileObjectRecord, FileObjectsStore } from "./types";

export interface StoreFileObjectInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly filename: string;
  readonly mime: string;
  /** Provisional free text; the consumer names the file class. */
  readonly retentionPolicy: string;
  /** The bytes to store. An empty upload is rejected (nothing is stored). */
  readonly bytes: Uint8Array;
  /** Optional polymorphic link (no FK); `'document'` for the document library. */
  readonly linkedEntityType?: string | null;
  readonly linkedEntityId?: string | null;
}

/**
 * Stores one file's bytes and creates its `file_object` metadata row
 * (`DEC-132`, the port that `DEC-085`/`DEC-099` recorded as missing).
 *
 * Order matters and is deliberate: the bytes are written first, then the
 * metadata row and its audit fact in one transaction. Because the filesystem is
 * not part of the database transaction, a failed metadata write is compensated
 * by deleting the bytes just stored (best effort); a crash between the two
 * leaves bytes with no row, which is harmless and swept by the later
 * retention/GC slice (a `ponytail:` ceiling named in `DEC-132`).
 *
 * The command validates the required fields and refuses an empty upload before
 * touching the storage, so a rejected upload writes nothing. The organization
 * is always passed through (`DEC-061`); `uploadedBy`/`createdBy` are the actor.
 */
export async function storeFileObject(
  store: FileObjectsStore,
  storage: FileStoragePort,
  input: StoreFileObjectInput,
): Promise<FileObjectRecord> {
  if (isBlank(input.filename)) {
    throw new DomainError("filename is required");
  }
  if (isBlank(input.mime)) {
    throw new DomainError("mime is required");
  }
  if (isBlank(input.retentionPolicy)) {
    throw new DomainError("retentionPolicy is required");
  }
  if (input.bytes.byteLength === 0) {
    throw new DomainError("file is empty");
  }

  const storageKey = buildStorageKey(input.organizationId, input.filename);
  const stored = await storage.put({ storageKey, bytes: input.bytes });

  try {
    return await store.withTransaction(async (tx) => {
      const record = await tx.createFileObject({
        organizationId: input.organizationId,
        storageKey,
        filename: input.filename.trim(),
        mime: input.mime.trim(),
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        retentionPolicy: input.retentionPolicy.trim(),
        uploadedBy: input.actorId,
        linkedEntityType: input.linkedEntityType ?? null,
        linkedEntityId: input.linkedEntityId ?? null,
        createdBy: input.actorId,
      });

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: FILE_AUDIT_ACTIONS.fileObjectCreated,
        entityType: "file_object",
        entityId: record.id,
        after: {
          storage_key: record.storageKey,
          filename: record.filename,
          mime: record.mime,
          size_bytes: record.sizeBytes,
          checksum_sha256: record.checksumSha256,
          retention_policy: record.retentionPolicy,
          linked_entity_type: record.linkedEntityType,
          linked_entity_id: record.linkedEntityId,
        },
      });

      return record;
    });
  } catch (error) {
    // The filesystem write is not part of the database transaction; compensate.
    await storage.remove(storageKey).catch(() => undefined);
    throw error;
  }
}
