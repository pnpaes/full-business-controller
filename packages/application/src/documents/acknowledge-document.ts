import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { DOCUMENT_AUDIT_ACTIONS } from "./actions";
import type { DocumentAcknowledgementRecord, DocumentsStore } from "./types";

export interface AcknowledgeDocumentInput {
  readonly organizationId: string;
  readonly documentId: string;
  /** The version to acknowledge; omitted resolves the current published version. */
  readonly documentVersionId?: string;
  /** The acknowledging user (`acknowledged_by`); also the acting actor. */
  readonly actorId: string;
}

/**
 * Records that one user acknowledged one version of a document (`DOC-004`,
 * `DEC-088`). The document is loaded organization-scoped first (`DEC-061`; a
 * missing or cross-organization id is a typed `NotFoundError`).
 *
 * The target version is either the explicitly supplied one (which must exist,
 * belong to the document and be **published**) or, when omitted, the document's
 * **current published version** — the greatest published version, which ignores
 * any newer unpublished draft. Acknowledgement is
 * **idempotent**: if a fact already exists for `(version, acknowledgedBy)` it is
 * returned unchanged with **no** new audit fact, so a retry cannot manufacture a
 * spurious `documents.document_acknowledgement.created` fact. Otherwise the fact
 * is created at the current instant and audited.
 */
export async function acknowledgeDocument(
  store: DocumentsStore,
  input: AcknowledgeDocumentInput,
): Promise<DocumentAcknowledgementRecord> {
  if (isBlank(input.documentId)) {
    throw new DomainError("documentId is required");
  }

  return store.withTransaction(async (tx) => {
    const document = await tx.findDocument({
      organizationId: input.organizationId,
      documentId: input.documentId.trim(),
    });
    if (document === undefined) {
      throw new NotFoundError("document not found in organization");
    }

    let documentVersionId: string;
    if (input.documentVersionId !== undefined) {
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
      if (version.publishedAt === null) {
        throw new DomainError("only a published version can be acknowledged");
      }
      documentVersionId = version.id;
    } else {
      const current = await tx.findCurrentPublishedVersion({
        organizationId: input.organizationId,
        documentId: document.id,
      });
      if (current === undefined) {
        throw new DomainError("the document has no published version to acknowledge");
      }
      documentVersionId = current.id;
    }

    const existing = await tx.findDocumentAcknowledgement({
      organizationId: input.organizationId,
      documentVersionId,
      acknowledgedBy: input.actorId,
    });
    if (existing !== undefined) {
      return existing;
    }

    const acknowledgement = await tx.createDocumentAcknowledgement({
      organizationId: input.organizationId,
      documentVersionId,
      acknowledgedBy: input.actorId,
      acknowledgedAt: new Date().toISOString(),
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: DOCUMENT_AUDIT_ACTIONS.documentAcknowledgementCreated,
      entityType: "document_acknowledgement",
      entityId: acknowledgement.id,
      after: {
        document_version_id: acknowledgement.documentVersionId,
        acknowledged_by: acknowledgement.acknowledgedBy,
        acknowledged_at: acknowledgement.acknowledgedAt,
      },
    });

    return acknowledgement;
  });
}
