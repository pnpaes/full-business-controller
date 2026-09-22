import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  DocumentAcknowledgementListQuery,
  DocumentAcknowledgementRecord,
  DocumentListQuery,
  DocumentRecord,
  DocumentsStore,
  DocumentVersionListQuery,
  DocumentVersionRecord,
  NewDocumentAcknowledgementRecord,
  NewDocumentRecord,
  NewDocumentVersionRecord,
  PublishDocumentVersionRecord,
  UpdateDocumentRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toDocument(row: repo.Document): DocumentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    category: row.category,
    audience: row.audience,
    status: row.status,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

function toDocumentVersion(row: repo.DocumentVersion): DocumentVersionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentId: row.documentId,
    // The persistence column is `version_no` (the audit columns own `version`).
    version: row.versionNo,
    fileObjectId: row.fileObjectId,
    notes: row.notes,
    publishedAt: toIso(row.publishedAt),
    publishedBy: row.publishedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDocumentAcknowledgement(
  row: repo.DocumentAcknowledgement,
): DocumentAcknowledgementRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentVersionId: row.documentVersionId,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
  };
}

/**
 * Adapts the persistence staff-document repository to the `DocumentsStore`
 * port: the `timestamptz` columns become ISO strings on read and `Date`s on
 * write, the `version_no` column becomes the application `version` field, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope. `actorId` is threaded into the audit columns.
 */
export function createPostgresDocumentsStore(db: Database): DocumentsStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresDocumentsStore(db));
      }
      return db.transaction((tx) => fn(createPostgresDocumentsStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createDocument: async (input: NewDocumentRecord) =>
      toDocument(
        await repo.createDocument(db, {
          organizationId: input.organizationId,
          title: input.title,
          category: input.category,
          audience: input.audience,
          status: input.status,
          ownerId: input.ownerId,
          createdBy: input.createdBy,
        }),
      ),
    findDocument: async (query) => {
      const row = await repo.findDocument(db, {
        organizationId: query.organizationId,
        documentId: query.documentId,
      });
      return row === undefined ? undefined : toDocument(row);
    },
    lockDocument: async (query) => {
      const row = await repo.lockDocument(db, {
        organizationId: query.organizationId,
        documentId: query.documentId,
      });
      return row === undefined ? undefined : toDocument(row);
    },
    updateDocument: async (input: UpdateDocumentRecord) => {
      const row = await repo.updateDocument(db, {
        organizationId: input.organizationId,
        documentId: input.documentId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.audience === undefined ? {} : { audience: input.audience }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(input.updatedBy == null ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toDocument(row);
    },
    listDocuments: async (query: DocumentListQuery) => {
      const rows = await repo.listDocuments(db, {
        organizationId: query.organizationId,
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.audience === undefined ? {} : { audience: query.audience }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toDocument);
    },
    createDocumentVersion: async (input: NewDocumentVersionRecord) =>
      toDocumentVersion(
        await repo.createDocumentVersion(db, {
          organizationId: input.organizationId,
          documentId: input.documentId,
          versionNo: input.version,
          fileObjectId: input.fileObjectId,
          notes: input.notes,
          createdBy: input.createdBy,
        }),
      ),
    findDocumentVersion: async (query) => {
      const row = await repo.findDocumentVersion(db, {
        organizationId: query.organizationId,
        documentVersionId: query.documentVersionId,
      });
      return row === undefined ? undefined : toDocumentVersion(row);
    },
    findLatestDocumentVersion: async (query) => {
      const row = await repo.findLatestDocumentVersion(db, {
        organizationId: query.organizationId,
        documentId: query.documentId,
      });
      return row === undefined ? undefined : toDocumentVersion(row);
    },
    findCurrentPublishedVersion: async (query) => {
      const row = await repo.findCurrentPublishedVersion(db, {
        organizationId: query.organizationId,
        documentId: query.documentId,
      });
      return row === undefined ? undefined : toDocumentVersion(row);
    },
    publishDocumentVersion: async (input: PublishDocumentVersionRecord) => {
      const row = await repo.publishDocumentVersion(db, {
        organizationId: input.organizationId,
        documentVersionId: input.documentVersionId,
        publishedAt: new Date(input.publishedAt),
        publishedBy: input.publishedBy,
        ...(input.actorId == null ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toDocumentVersion(row);
    },
    listDocumentVersions: async (query: DocumentVersionListQuery) => {
      const rows = await repo.listDocumentVersions(db, {
        organizationId: query.organizationId,
        documentId: query.documentId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toDocumentVersion);
    },
    createDocumentAcknowledgement: async (input: NewDocumentAcknowledgementRecord) =>
      toDocumentAcknowledgement(
        await repo.createDocumentAcknowledgement(db, {
          organizationId: input.organizationId,
          documentVersionId: input.documentVersionId,
          acknowledgedBy: input.acknowledgedBy,
          acknowledgedAt: new Date(input.acknowledgedAt),
        }),
      ),
    findDocumentAcknowledgement: async (query) => {
      const row = await repo.findDocumentAcknowledgement(db, {
        organizationId: query.organizationId,
        documentVersionId: query.documentVersionId,
        acknowledgedBy: query.acknowledgedBy,
      });
      return row === undefined ? undefined : toDocumentAcknowledgement(row);
    },
    listDocumentAcknowledgements: async (query: DocumentAcknowledgementListQuery) => {
      const rows = await repo.listDocumentAcknowledgements(db, {
        organizationId: query.organizationId,
        ...(query.documentId === undefined ? {} : { documentId: query.documentId }),
        ...(query.documentVersionId === undefined
          ? {}
          : { documentVersionId: query.documentVersionId }),
        ...(query.acknowledgedBy === undefined ? {} : { acknowledgedBy: query.acknowledgedBy }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toDocumentAcknowledgement);
    },
  };
}
