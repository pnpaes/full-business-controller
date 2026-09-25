import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { FileObjectRecord, FileObjectsStore, NewFileObjectRecord } from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toFileObject(row: repo.FileObject): FileObjectRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    storageKey: row.storageKey,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    retentionPolicy: row.retentionPolicy,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    linkedEntityType: row.linkedEntityType,
    linkedEntityId: row.linkedEntityId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Adapts the persistence `file_object` repository to the `FileObjectsStore`
 * port (`DEC-132`): the `timestamptz` columns become ISO strings on read,
 * `size_bytes` stays a number and every read/write takes the organization so the
 * adapter cannot escape the `DEC-061` row scope. No storage client lives here:
 * this adapter touches metadata only.
 */
export function createPostgresFileObjectsStore(db: Database): FileObjectsStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresFileObjectsStore(db));
      }
      return db.transaction((tx) => fn(createPostgresFileObjectsStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createFileObject: async (input: NewFileObjectRecord) =>
      toFileObject(
        await repo.createFileObject(db, {
          organizationId: input.organizationId,
          storageKey: input.storageKey,
          filename: input.filename,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256,
          retentionPolicy: input.retentionPolicy,
          uploadedBy: input.uploadedBy,
          linkedEntityType: input.linkedEntityType,
          linkedEntityId: input.linkedEntityId,
          createdBy: input.createdBy,
        }),
      ),
    findFileObject: async (query) => {
      const row = await repo.findFileObject(db, {
        organizationId: query.organizationId,
        fileObjectId: query.fileObjectId,
      });
      return row === undefined ? undefined : toFileObject(row);
    },
    listFileObjects: async (query) => {
      const rows = await repo.listFileObjects(db, {
        organizationId: query.organizationId,
        linkedEntityType: query.linkedEntityType,
        linkedEntityId: query.linkedEntityId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toFileObject);
    },
  };
}
