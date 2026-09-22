import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the staff document library slice
 * (`DEC-088`, `DOC-001`…`DOC-004`).
 *
 * All three tables (`document`, `document_version`,
 * `document_acknowledgement`) carry `organization_id` directly, so every read
 * and write takes the organization and is scoped by it (`DEC-061`).
 * `timestamptz` columns cross the port as ISO strings and the version counter
 * crosses as a number. The persistence column is `version_no` (a manual
 * per-document counter, deliberately not named `version` because the shared
 * audit columns own that name); at this layer the record field is `version`.
 *
 * This is a **different domain from the workforce personnel documents** (those
 * have no revision model, `DEC-087`), so it has its own `DocumentsStore` port
 * rather than extending `WorkforceStore`.
 */

/** One `document` row (`DEC-088`, `DOC-001`). */
export interface DocumentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  /** One of `DOCUMENT_CATEGORY`. */
  readonly category: string;
  /** One of `DOCUMENT_AUDIENCE`. */
  readonly audience: string;
  /** One of `STAFF_DOCUMENT_STATUS`: `draft` → `published` → `archived`. */
  readonly status: string;
  /** Plain uuid; the `app_user` FK is deferred, like `created_by`. */
  readonly ownerId: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; the last amendment, or null before any update. */
  readonly updatedAt: string | null;
}

export interface NewDocumentRecord {
  readonly organizationId: string;
  readonly title: string;
  /** One of `DOCUMENT_CATEGORY`. */
  readonly category: string;
  /** One of `DOCUMENT_AUDIENCE`. */
  readonly audience: string;
  /** One of `STAFF_DOCUMENT_STATUS`; a new document starts `draft`. */
  readonly status: string;
  readonly ownerId: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * The mutable fields of a document. `undefined` means "leave as is"; `null`
 * clears an optional field. `status` is special: the only value a caller may
 * set is `archived` (publishing happens through a version).
 */
export interface DocumentPatch {
  readonly title?: string;
  /** One of `DOCUMENT_CATEGORY`. */
  readonly category?: string;
  /** One of `DOCUMENT_AUDIENCE`. */
  readonly audience?: string;
  readonly ownerId?: string | null;
  /** Only `archived` is accepted; `draft`/`published` are rejected. */
  readonly status?: string;
}

/** An organization-scoped patch of one document by id (`DEC-061`). */
export interface UpdateDocumentRecord extends DocumentPatch {
  readonly organizationId: string;
  readonly documentId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Document filters for the store read. */
export interface DocumentListQuery {
  readonly organizationId: string;
  /** One of `DOCUMENT_CATEGORY`, exact match. */
  readonly category?: string;
  /** One of `DOCUMENT_AUDIENCE`, exact match. */
  readonly audience?: string;
  /** One of `STAFF_DOCUMENT_STATUS`, exact match. */
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `document_version` row (`DEC-088`, `DOC-002`). `version` is the manual
 * per-document counter (`unique (document_id, version_no)`); `fileObjectId` is a
 * nullable real FK to `file_object` (the storage path stays deferred,
 * `DEC-085`). `publishedAt`/`publishedBy` are an all-or-nothing pair: both null
 * while a draft, both set once published.
 */
export interface DocumentVersionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly documentId: string;
  readonly version: number;
  readonly fileObjectId: string | null;
  readonly notes: string | null;
  /** `timestamptz`, ISO, or null while unpublished. */
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewDocumentVersionRecord {
  readonly organizationId: string;
  readonly documentId: string;
  readonly version: number;
  readonly fileObjectId: string | null;
  readonly notes: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** Publishes one version: both stamps are set together (`DEC-002` precedence). */
export interface PublishDocumentVersionRecord {
  readonly organizationId: string;
  readonly documentVersionId: string;
  /** `timestamptz`, ISO: the publication instant. */
  readonly publishedAt: string;
  readonly publishedBy: string;
  /** The acting actor; recorded on the version's audit columns. */
  readonly actorId?: string | null;
}

/** Version filters for the store read. */
export interface DocumentVersionListQuery {
  readonly organizationId: string;
  readonly documentId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `document_acknowledgement` row (`DEC-088`, `DOC-004`): the fact that one
 * user acknowledged one version. The row carries its own actor and instant (it
 * has no audit columns), and `unique (document_version_id, acknowledged_by)`
 * makes an acknowledgement idempotent per user per version.
 */
export interface DocumentAcknowledgementRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly documentVersionId: string;
  readonly acknowledgedBy: string;
  /** `timestamptz`, ISO. */
  readonly acknowledgedAt: string;
}

export interface NewDocumentAcknowledgementRecord {
  readonly organizationId: string;
  readonly documentVersionId: string;
  readonly acknowledgedBy: string;
  /** `timestamptz`, ISO. */
  readonly acknowledgedAt: string;
}

/** Acknowledgement filters for the store read. */
export interface DocumentAcknowledgementListQuery {
  readonly organizationId: string;
  /** Scopes the read to one document's versions (joined through `document_version`). */
  readonly documentId?: string;
  readonly documentVersionId?: string;
  readonly acknowledgedBy?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the staff document library: the `document` entity,
 * its versions and its acknowledgements. One port covers all three tables,
 * mirroring the persistence repository module.
 */
export interface DocumentsStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: DocumentsStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createDocument(input: NewDocumentRecord): Promise<DocumentRecord>;
  /** One document by id, organization-scoped (`DEC-061`), or `undefined`. */
  findDocument(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentRecord | undefined>;
  /**
   * One document by id, organization-scoped (`DEC-061`), or `undefined`, taking
   * the row's write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding
   * transaction. The commands that derive state from the document's versions lock
   * it first so concurrent writes against one document serialise.
   */
  lockDocument(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentRecord | undefined>;
  /**
   * Applies a patch to one document, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateDocument(input: UpdateDocumentRecord): Promise<DocumentRecord | undefined>;
  listDocuments(query: DocumentListQuery): Promise<readonly DocumentRecord[]>;
  createDocumentVersion(input: NewDocumentVersionRecord): Promise<DocumentVersionRecord>;
  /** One version by id, organization-scoped (`DEC-061`), or `undefined`. */
  findDocumentVersion(query: {
    readonly organizationId: string;
    readonly documentVersionId: string;
  }): Promise<DocumentVersionRecord | undefined>;
  /**
   * The highest-numbered version of one document (`version_no` greatest), or
   * `undefined` when the document has none.
   */
  findLatestDocumentVersion(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentVersionRecord | undefined>;
  /**
   * The greatest **published** version of one document (`publishedAt` set), or
   * `undefined` when the document has no published version (`DOC-002`). A newer
   * unpublished version does not shadow it.
   */
  findCurrentPublishedVersion(query: {
    readonly organizationId: string;
    readonly documentId: string;
  }): Promise<DocumentVersionRecord | undefined>;
  /**
   * Stamps one version published, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization.
   */
  publishDocumentVersion(
    input: PublishDocumentVersionRecord,
  ): Promise<DocumentVersionRecord | undefined>;
  listDocumentVersions(query: DocumentVersionListQuery): Promise<readonly DocumentVersionRecord[]>;
  createDocumentAcknowledgement(
    input: NewDocumentAcknowledgementRecord,
  ): Promise<DocumentAcknowledgementRecord>;
  /** One acknowledgement fact, organization-scoped (`DEC-061`), or `undefined`. */
  findDocumentAcknowledgement(query: {
    readonly organizationId: string;
    readonly documentVersionId: string;
    readonly acknowledgedBy: string;
  }): Promise<DocumentAcknowledgementRecord | undefined>;
  listDocumentAcknowledgements(
    query: DocumentAcknowledgementListQuery,
  ): Promise<readonly DocumentAcknowledgementRecord[]>;
}
