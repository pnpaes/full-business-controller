import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { DOCUMENT_AUDIT_ACTIONS } from "./actions";
import type { DocumentVersionRecord, DocumentsStore } from "./types";

export interface PublishDocumentVersionInput {
  readonly organizationId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly actorId: string;
}

/**
 * Publishes one version of a document (`DOC-002`, `DEC-088`). The document and
 * the version are loaded organization-scoped first (`DEC-061`; a missing or
 * cross-organization id is a typed `NotFoundError`); the document is loaded
 * **with a row lock** (`SELECT … FOR UPDATE`) so the "latest version" check below
 * cannot race a concurrent create/publish against the same document. The rules
 * are then applied:
 *
 * - an **archived** document accepts no publication;
 * - the version must belong to the addressed document;
 * - a version that is already published is rejected (publishing is a one-way
 *   stamp, not a re-stamp);
 * - only the document's **latest** version may be published, so an older draft
 *   cannot leapfrog a newer one.
 *
 * Publication stamps `published_at`/`published_by` together, and a document that
 * is still `draft` is promoted to `published` (a document already `published`
 * stays so; it is never returned to `draft`). The stamps, the document promotion
 * and the audit fact commit or roll back together.
 */
export async function publishDocumentVersion(
  store: DocumentsStore,
  input: PublishDocumentVersionInput,
): Promise<DocumentVersionRecord> {
  if (isBlank(input.documentId)) {
    throw new DomainError("documentId is required");
  }
  if (isBlank(input.documentVersionId)) {
    throw new DomainError("documentVersionId is required");
  }

  return store.withTransaction(async (tx) => {
    const document = await tx.lockDocument({
      organizationId: input.organizationId,
      documentId: input.documentId.trim(),
    });
    if (document === undefined) {
      throw new NotFoundError("document not found in organization");
    }
    if (document.status === "archived") {
      throw new DomainError("cannot publish a version of an archived document");
    }

    const version = await tx.findDocumentVersion({
      organizationId: input.organizationId,
      documentVersionId: input.documentVersionId.trim(),
    });
    if (version === undefined) {
      throw new NotFoundError("document version not found in organization");
    }
    if (version.documentId !== document.id) {
      throw new DomainError("document version does not belong to the document");
    }
    if (version.publishedAt !== null) {
      throw new DomainError("document version is already published");
    }

    const latest = await tx.findLatestDocumentVersion({
      organizationId: input.organizationId,
      documentId: document.id,
    });
    if (latest !== undefined && latest.version > version.version) {
      throw new DomainError("only the latest version can be published");
    }

    const publishedAt = new Date().toISOString();
    const published = await tx.publishDocumentVersion({
      organizationId: input.organizationId,
      documentVersionId: version.id,
      publishedAt,
      publishedBy: input.actorId,
      actorId: input.actorId,
    });
    if (published === undefined) {
      throw new NotFoundError("document version not found in organization");
    }

    if (document.status === "draft") {
      await tx.updateDocument({
        organizationId: input.organizationId,
        documentId: document.id,
        status: "published",
        updatedBy: input.actorId,
      });
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: DOCUMENT_AUDIT_ACTIONS.documentVersionPublished,
      entityType: "document_version",
      entityId: published.id,
      before: {
        published_at: version.publishedAt,
        published_by: version.publishedBy,
        document_status: document.status,
      },
      after: {
        published_at: published.publishedAt,
        published_by: published.publishedBy,
        document_status: document.status === "draft" ? "published" : document.status,
      },
    });

    return published;
  });
}
