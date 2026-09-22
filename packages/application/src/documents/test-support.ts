import type { AuditInput } from "../auth";

import { DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT } from "./list-document-acknowledgements";
import { DEFAULT_DOCUMENT_VERSION_LIMIT } from "./list-document-versions";
import { DEFAULT_DOCUMENT_LIMIT } from "./list-documents";
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

/**
 * A shallow copy of every mutable map/array a documents transaction can touch,
 * used to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface DocumentsSnapshot {
  readonly documents: Map<string, DocumentRecord>;
  readonly documentVersions: Map<string, DocumentVersionRecord>;
  readonly documentAcknowledgements: Map<string, DocumentAcknowledgementRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `DocumentsStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, ordering and paging so the commands and
 * queries can be exercised without a database; `documents.postgres.test.ts`
 * covers the real adapter.
 */
export class FakeDocumentsStore implements DocumentsStore {
  readonly documents = new Map<string, DocumentRecord>();
  readonly documentVersions = new Map<string, DocumentVersionRecord>();
  readonly documentAcknowledgements = new Map<string, DocumentAcknowledgementRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: DocumentsStore) => Promise<T>): Promise<T> {
    // Snapshot then run so a failure mid-transaction rolls back every write
    // (a write and its audit fact commit or roll back together, like the
    // Postgres adapter).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): DocumentsSnapshot {
    return {
      documents: new Map(this.documents),
      documentVersions: new Map(this.documentVersions),
      documentAcknowledgements: new Map(this.documentAcknowledgements),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: DocumentsSnapshot): void {
    this.documents.clear();
    for (const [key, value] of snapshot.documents) this.documents.set(key, value);
    this.documentVersions.clear();
    for (const [key, value] of snapshot.documentVersions) this.documentVersions.set(key, value);
    this.documentAcknowledgements.clear();
    for (const [key, value] of snapshot.documentAcknowledgements) {
      this.documentAcknowledgements.set(key, value);
    }
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createDocument(input: NewDocumentRecord): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      id: this.nextId("document"),
      organizationId: input.organizationId,
      title: input.title,
      category: input.category,
      audience: input.audience,
      status: input.status,
      ownerId: input.ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.documents.set(record.id, record);
    return record;
  }

  async findDocument(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentRecord | undefined> {
    const document = this.documents.get(query.documentId);
    return document !== undefined && document.organizationId === query.organizationId
      ? document
      : undefined;
  }

  async lockDocument(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentRecord | undefined> {
    // The fake runs inline, so there is no concurrent writer to serialise
    // against: the lock is a plain find satisfying the port contract.
    return this.findDocument(query);
  }

  async updateDocument(input: UpdateDocumentRecord): Promise<DocumentRecord | undefined> {
    const existing = await this.findDocument({
      organizationId: input.organizationId,
      documentId: input.documentId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: DocumentRecord = {
      ...existing,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.audience === undefined ? {} : { audience: input.audience }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(record.id, record);
    return record;
  }

  async listDocuments(query: DocumentListQuery): Promise<readonly DocumentRecord[]> {
    const rows = [...this.documents.values()]
      .filter((document) => document.organizationId === query.organizationId)
      .filter((document) => query.category === undefined || document.category === query.category)
      .filter((document) => query.audience === undefined || document.audience === query.audience)
      .filter((document) => query.status === undefined || document.status === query.status)
      .sort((a, b) => {
        if (a.title !== b.title) return a.title < b.title ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Default to the application page cap, mirroring the Postgres adapter and
    // the query: an omitted `limit` must never hand back the whole library.
    const limit = query.limit ?? DEFAULT_DOCUMENT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async createDocumentVersion(input: NewDocumentVersionRecord): Promise<DocumentVersionRecord> {
    const record: DocumentVersionRecord = {
      id: this.nextId("document-version"),
      organizationId: input.organizationId,
      documentId: input.documentId,
      version: input.version,
      fileObjectId: input.fileObjectId,
      notes: input.notes,
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date().toISOString(),
    };
    this.documentVersions.set(record.id, record);
    return record;
  }

  async findDocumentVersion(query: {
    readonly organizationId: string;
    readonly documentVersionId: string;
  }): Promise<DocumentVersionRecord | undefined> {
    const version = this.documentVersions.get(query.documentVersionId);
    return version !== undefined && version.organizationId === query.organizationId
      ? version
      : undefined;
  }

  async findLatestDocumentVersion(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentVersionRecord | undefined> {
    const versions = [...this.documentVersions.values()].filter(
      (version) =>
        version.organizationId === query.organizationId && version.documentId === query.documentId,
    );
    let latest: DocumentVersionRecord | undefined;
    for (const version of versions) {
      if (latest === undefined || version.version > latest.version) latest = version;
    }
    return latest;
  }

  async findCurrentPublishedVersion(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentVersionRecord | undefined> {
    const versions = [...this.documentVersions.values()].filter(
      (version) =>
        version.organizationId === query.organizationId &&
        version.documentId === query.documentId &&
        version.publishedAt !== null,
    );
    let current: DocumentVersionRecord | undefined;
    for (const version of versions) {
      if (current === undefined || version.version > current.version) current = version;
    }
    return current;
  }

  async publishDocumentVersion(
    input: PublishDocumentVersionRecord,
  ): Promise<DocumentVersionRecord | undefined> {
    const existing = await this.findDocumentVersion({
      organizationId: input.organizationId,
      documentVersionId: input.documentVersionId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it (rollback-safe, as above).
    const record: DocumentVersionRecord = {
      ...existing,
      publishedAt: input.publishedAt,
      publishedBy: input.publishedBy,
    };
    this.documentVersions.set(record.id, record);
    return record;
  }

  async listDocumentVersions(
    query: DocumentVersionListQuery,
  ): Promise<readonly DocumentVersionRecord[]> {
    const rows = [...this.documentVersions.values()]
      .filter((version) => version.organizationId === query.organizationId)
      .filter((version) => version.documentId === query.documentId)
      .sort((a, b) => {
        if (a.version !== b.version) return a.version - b.version;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? DEFAULT_DOCUMENT_VERSION_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async createDocumentAcknowledgement(
    input: NewDocumentAcknowledgementRecord,
  ): Promise<DocumentAcknowledgementRecord> {
    const record: DocumentAcknowledgementRecord = {
      id: this.nextId("document-acknowledgement"),
      organizationId: input.organizationId,
      documentVersionId: input.documentVersionId,
      acknowledgedBy: input.acknowledgedBy,
      acknowledgedAt: input.acknowledgedAt,
    };
    this.documentAcknowledgements.set(record.id, record);
    return record;
  }

  async findDocumentAcknowledgement(query: {
    readonly organizationId: string;
    readonly documentVersionId: string;
    readonly acknowledgedBy: string;
  }): Promise<DocumentAcknowledgementRecord | undefined> {
    return [...this.documentAcknowledgements.values()].find(
      (row) =>
        row.organizationId === query.organizationId &&
        row.documentVersionId === query.documentVersionId &&
        row.acknowledgedBy === query.acknowledgedBy,
    );
  }

  async listDocumentAcknowledgements(
    query: DocumentAcknowledgementListQuery,
  ): Promise<readonly DocumentAcknowledgementRecord[]> {
    // Mirrors the Postgres adapter's `documentId` join through
    // `document_version`: keep only rows whose version belongs to the document.
    const versionIdsForDocument =
      query.documentId === undefined
        ? undefined
        : new Set(
            [...this.documentVersions.values()]
              .filter((version) => version.documentId === query.documentId)
              .map((version) => version.id),
          );
    const rows = [...this.documentAcknowledgements.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter(
        (row) =>
          versionIdsForDocument === undefined || versionIdsForDocument.has(row.documentVersionId),
      )
      .filter(
        (row) =>
          query.documentVersionId === undefined ||
          row.documentVersionId === query.documentVersionId,
      )
      .filter(
        (row) => query.acknowledgedBy === undefined || row.acknowledgedBy === query.acknowledgedBy,
      )
      .sort((a, b) => {
        // Newest first, then id: mirrors the Postgres adapter's ordering.
        if (a.acknowledgedAt !== b.acknowledgedAt) {
          return a.acknowledgedAt < b.acknowledgedAt ? 1 : -1;
        }
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Mirror the acknowledgement query's page cap: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT;
    return rows.slice(offset, offset + limit);
  }
}

export interface DocumentsFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly otherActorId: string;
}

/**
 * Seeds the two-organization fixture the documents tests share: two organization
 * ids so a row can be created in one and read from the other, plus two actors so
 * acknowledgements can be attributed and idempotency exercised.
 */
export function seedDocumentsFixture(): DocumentsFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    otherActorId: "actor-2",
  };
}
