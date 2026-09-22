import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import type { Database } from "../client";
import { document, documentAcknowledgement, documentVersion } from "../schema";

export type Document = typeof document.$inferSelect;
export type DocumentVersion = typeof documentVersion.$inferSelect;
export type DocumentAcknowledgement = typeof documentAcknowledgement.$inferSelect;

/*
 * `DEC-088` (`DOC-001`…`DOC-004`): the staff document library.
 *
 * All three tables carry `organization_id` directly, so every read and write
 * that takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row.
 *
 * `document` is the mutable parent (`updateDocument`): `category`, `audience`
 * and `status` are checked against the `DOCUMENT_CATEGORY` / `DOCUMENT_AUDIENCE`
 * / `STAFF_DOCUMENT_STATUS` vocabularies and `ownerId` is a plain uuid (the
 * `app_user` FK is deferred repo-wide, the `hms_incident.owner_id` precedent).
 * `documentVersion` is the manual version chain: `versionNo` is the
 * per-document counter with `unique (document_id, version_no)` behind it,
 * `fileObjectId` a nullable real FK into `file_object` (the storage path stays
 * deferred, `DEC-085`) and `publishedAt`/`publishedBy` the all-or-nothing
 * publication pair (`publishDocumentVersion`).
 * `documentAcknowledgement` is a fact table: create + read only, no
 * `auditColumns()` (the `import_disposition` precedent — the row carries its own
 * actor and instant).
 *
 * The vocabulary columns, the `version_no > 0` / published-pair checks, the
 * `(document_id, version_no)` unique, the `(document_version_id,
 * acknowledged_by)` unique and the cross-organization guards are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so callers see a `DomainError`.
 */

export interface CreateDocumentInput {
  readonly organizationId: string;
  readonly title: string;
  /** Checked against the `DOCUMENT_CATEGORY` vocabulary. */
  readonly category: string;
  /** Checked against the `DOCUMENT_AUDIENCE` vocabulary. */
  readonly audience: string;
  /** Checked against `STAFF_DOCUMENT_STATUS`; defaults to `draft`. */
  readonly status?: string;
  /** Plain uuid; the `app_user` FK is deferred (the `DEC-095` precedent). */
  readonly ownerId?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one document row. `organizationId` is supplied by the caller. */
export async function createDocument(db: Database, input: CreateDocumentInput): Promise<Document> {
  const rows = await db
    .insert(document)
    .values({
      organizationId: input.organizationId,
      title: input.title,
      category: input.category,
      audience: input.audience,
      ...(input.status === undefined ? {} : { status: input.status }),
      ownerId: input.ownerId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindDocumentQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/** One document by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findDocument(
  db: Database,
  query: FindDocumentQuery,
): Promise<Document | undefined> {
  const rows = await db
    .select()
    .from(document)
    .where(
      and(eq(document.id, query.documentId), eq(document.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped select as `findDocument`, but taking the row's write lock
 * (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction. A missing
 * or cross-organization id returns `undefined` without locking anything. The
 * commands that derive state from the document's versions (`createDocumentVersion`
 * numbering the next `version_no`, `publishDocumentVersion` checking "latest")
 * call this first, so concurrent transactions against one document serialise
 * instead of colliding on the unique `(document_id, version_no)` (23505) or
 * publishing a stale version.
 */
export async function lockDocument(
  db: Database,
  query: FindDocumentQuery,
): Promise<Document | undefined> {
  const rows = await db
    .select()
    .from(document)
    .where(
      and(eq(document.id, query.documentId), eq(document.organizationId, query.organizationId)),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

export interface UpdateDocumentInput {
  readonly organizationId: string;
  readonly documentId: string;
  readonly title?: string;
  readonly category?: string;
  readonly audience?: string;
  readonly status?: string;
  /** Explicit `null` clears the owner; an omitted field is untouched. */
  readonly ownerId?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string;
}

/**
 * Updates one document row's mutable fields, organization-scoped (`DEC-061`).
 * A field left out of the patch is untouched (drizzle skips `undefined`), while
 * an explicit value replaces it and an explicit `null` clears `ownerId`; the
 * audit columns record the amendment. The id alone cannot address another
 * tenant's row — a missing or cross-organization id returns `undefined`,
 * exactly like `findDocument`.
 */
export async function updateDocument(
  db: Database,
  input: UpdateDocumentInput,
): Promise<Document | undefined> {
  const { organizationId, documentId, actorId, ...patch } = input;
  const rows = await db
    .update(document)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(document.id, documentId), eq(document.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListDocumentsQuery {
  readonly organizationId: string;
  readonly category?: string;
  readonly audience?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Document rows for one organization, ordered by `title` (then `id`), with
 * optional category, audience and status filters. The organization filter is
 * never optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listDocuments(
  db: Database,
  query: ListDocumentsQuery,
): Promise<readonly Document[]> {
  const statement = db
    .select()
    .from(document)
    .where(
      and(
        eq(document.organizationId, query.organizationId),
        query.category === undefined ? undefined : eq(document.category, query.category),
        query.audience === undefined ? undefined : eq(document.audience, query.audience),
        query.status === undefined ? undefined : eq(document.status, query.status),
      ),
    )
    .orderBy(asc(document.title), asc(document.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateDocumentVersionInput {
  readonly organizationId: string;
  /** NOT NULL: a version must hang off a document (FK, guarded by `0049`). */
  readonly documentId: string;
  /** The manual per-document counter; must be `> 0` and unique per document. */
  readonly versionNo: number;
  /** Optional real FK to `file_object.id`; null when no bytes are attached. */
  readonly fileObjectId?: string | null;
  readonly notes?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one document-version row. `organizationId` is supplied by the caller. */
export async function createDocumentVersion(
  db: Database,
  input: CreateDocumentVersionInput,
): Promise<DocumentVersion> {
  const rows = await db
    .insert(documentVersion)
    .values({
      organizationId: input.organizationId,
      documentId: input.documentId,
      versionNo: input.versionNo,
      fileObjectId: input.fileObjectId ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindDocumentVersionQuery {
  readonly organizationId: string;
  readonly documentVersionId: string;
}

/** One document version by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findDocumentVersion(
  db: Database,
  query: FindDocumentVersionQuery,
): Promise<DocumentVersion | undefined> {
  const rows = await db
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.id, query.documentVersionId),
        eq(documentVersion.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FindLatestDocumentVersionQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/** The highest-`version_no` version of one document, or `undefined`. */
export async function findLatestDocumentVersion(
  db: Database,
  query: FindLatestDocumentVersionQuery,
): Promise<DocumentVersion | undefined> {
  const rows = await db
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.documentId, query.documentId),
        eq(documentVersion.organizationId, query.organizationId),
      ),
    )
    .orderBy(desc(documentVersion.versionNo))
    .limit(1);
  return rows[0];
}

export interface FindCurrentPublishedVersionQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/**
 * The greatest **published** version of one document (`published_at` set), or
 * `undefined` when the document has no published version (`DOC-002`). This is the
 * version staff see: a newer *unpublished* version does not shadow it, unlike
 * `findLatestDocumentVersion`, which returns the highest `version_no` regardless
 * of publication.
 */
export async function findCurrentPublishedVersion(
  db: Database,
  query: FindCurrentPublishedVersionQuery,
): Promise<DocumentVersion | undefined> {
  const rows = await db
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.organizationId, query.organizationId),
        eq(documentVersion.documentId, query.documentId),
        isNotNull(documentVersion.publishedAt),
      ),
    )
    .orderBy(desc(documentVersion.versionNo))
    .limit(1);
  return rows[0];
}

export interface PublishDocumentVersionInput {
  readonly organizationId: string;
  readonly documentVersionId: string;
  readonly publishedAt: Date;
  /** Plain uuid; the `app_user` FK is deferred. */
  readonly publishedBy: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string;
}

/**
 * Publishes one document version, organization-scoped (`DEC-061`): sets the
 * all-or-nothing `published_at`/`published_by` pair (the
 * `document_version_published_check` requires both or neither) and stamps the
 * audit columns. A missing or cross-organization id returns `undefined`.
 */
export async function publishDocumentVersion(
  db: Database,
  input: PublishDocumentVersionInput,
): Promise<DocumentVersion | undefined> {
  const { organizationId, documentVersionId, publishedAt, publishedBy, actorId } = input;
  const rows = await db
    .update(documentVersion)
    .set({
      publishedAt,
      publishedBy,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(documentVersion.id, documentVersionId),
        eq(documentVersion.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListDocumentVersionsQuery {
  readonly organizationId: string;
  readonly documentId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Document versions for one document, ordered by `version_no` (then `id`). The
 * organization filter is never optional (`DEC-061`); paging is applied after
 * the ordering.
 */
export async function listDocumentVersions(
  db: Database,
  query: ListDocumentVersionsQuery,
): Promise<readonly DocumentVersion[]> {
  const statement = db
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.organizationId, query.organizationId),
        eq(documentVersion.documentId, query.documentId),
      ),
    )
    .orderBy(asc(documentVersion.versionNo), asc(documentVersion.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateDocumentAcknowledgementInput {
  readonly organizationId: string;
  /** NOT NULL: an acknowledgement must hang off a version (FK, guarded by `0049`). */
  readonly documentVersionId: string;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: Date;
}

/** Appends one acknowledgement fact. `organizationId` is supplied by the caller. */
export async function createDocumentAcknowledgement(
  db: Database,
  input: CreateDocumentAcknowledgementInput,
): Promise<DocumentAcknowledgement> {
  const rows = await db
    .insert(documentAcknowledgement)
    .values({
      organizationId: input.organizationId,
      documentVersionId: input.documentVersionId,
      acknowledgedBy: input.acknowledgedBy,
      acknowledgedAt: input.acknowledgedAt,
    })
    .returning();
  return rows[0]!;
}

export interface FindDocumentAcknowledgementQuery {
  readonly organizationId: string;
  readonly documentVersionId: string;
  readonly acknowledgedBy: string;
}

/**
 * One user's acknowledgement of one version, organization-scoped (`DEC-061`),
 * or `undefined`. The `(document_version_id, acknowledged_by)` unique makes the
 * pair the natural key, so no id is needed.
 */
export async function findDocumentAcknowledgement(
  db: Database,
  query: FindDocumentAcknowledgementQuery,
): Promise<DocumentAcknowledgement | undefined> {
  const rows = await db
    .select()
    .from(documentAcknowledgement)
    .where(
      and(
        eq(documentAcknowledgement.organizationId, query.organizationId),
        eq(documentAcknowledgement.documentVersionId, query.documentVersionId),
        eq(documentAcknowledgement.acknowledgedBy, query.acknowledgedBy),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListDocumentAcknowledgementsQuery {
  readonly organizationId: string;
  /**
   * Scopes the read to the versions of one document, joined through
   * `document_version`. Omitted → every acknowledgement in the organization.
   */
  readonly documentId?: string;
  readonly documentVersionId?: string;
  readonly acknowledgedBy?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Acknowledgement facts for one organization, newest `acknowledged_at` first
 * (then `id`), with optional document, version and user filters. A
 * `documentId` scopes the read to one document's versions (an inner join
 * through `document_version`); the organization filter is never optional
 * (`DEC-061`); paging is applied after the ordering.
 */
export async function listDocumentAcknowledgements(
  db: Database,
  query: ListDocumentAcknowledgementsQuery,
): Promise<readonly DocumentAcknowledgement[]> {
  const statement = db
    .select({ acknowledgement: documentAcknowledgement })
    .from(documentAcknowledgement)
    .$dynamic();
  // Attach the join before the `where` predicate that references
  // `document_version.document_id` is built. `$dynamic()` returns `this`, so each
  // call mutates the same statement in place and the explicit projection keeps
  // the row shape `{ acknowledgement }` either way.
  if (query.documentId !== undefined) {
    statement.innerJoin(
      documentVersion,
      eq(documentAcknowledgement.documentVersionId, documentVersion.id),
    );
  }
  statement.where(
    and(
      eq(documentAcknowledgement.organizationId, query.organizationId),
      query.documentVersionId === undefined
        ? undefined
        : eq(documentAcknowledgement.documentVersionId, query.documentVersionId),
      query.acknowledgedBy === undefined
        ? undefined
        : eq(documentAcknowledgement.acknowledgedBy, query.acknowledgedBy),
      query.documentId === undefined ? undefined : eq(documentVersion.documentId, query.documentId),
    ),
  );
  statement.orderBy(desc(documentAcknowledgement.acknowledgedAt), asc(documentAcknowledgement.id));
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  const rows = await statement;
  return rows.map((row) => row.acknowledgement);
}
