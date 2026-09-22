import { DomainError, NotFoundError, nextDocumentVersionNumber } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { DOCUMENT_AUDIT_ACTIONS } from "./actions";
import type { DocumentVersionRecord, DocumentsStore } from "./types";

export interface CreateDocumentVersionInput {
  readonly organizationId: string;
  readonly documentId: string;
  /** Optional real FK to `file_object.id`; null when no bytes are attached. */
  readonly fileObjectId?: string | null;
  readonly notes?: string | null;
  readonly actorId: string;
}

/**
 * Creates the next version of one document (`DOC-002`, `DEC-088`). The document
 * is loaded organization-scoped first (`DEC-061`; a missing or cross-organization
 * id is a typed `NotFoundError`) **with a row lock** (`SELECT … FOR UPDATE`), so
 * concurrent version creations against one document serialise rather than race on
 * the unique `(document_id, version_no)`. An **archived** document is rejected: a
 * retired document accepts no new versions.
 *
 * The version number is derived from the greatest existing `version_no` plus one
 * (domain `nextDocumentVersionNumber`, fed by `findLatestDocumentVersion`), so
 * the counter stays manual and gapless per document — the unique
 * `(document_id, version_no)` constraint is the backstop. A new version starts
 * unpublished (`published_at`/`published_by` both null). The create and its
 * audit fact commit or roll back together.
 */
export async function createDocumentVersion(
  store: DocumentsStore,
  input: CreateDocumentVersionInput,
): Promise<DocumentVersionRecord> {
  if (isBlank(input.documentId)) {
    throw new DomainError("documentId is required");
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
      throw new DomainError("cannot add a version to an archived document");
    }

    const latest = await tx.findLatestDocumentVersion({
      organizationId: input.organizationId,
      documentId: document.id,
    });
    const version = nextDocumentVersionNumber(latest === undefined ? [] : [latest]);

    const created = await tx.createDocumentVersion({
      organizationId: input.organizationId,
      documentId: document.id,
      version,
      fileObjectId: input.fileObjectId ?? null,
      notes: input.notes ?? null,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: DOCUMENT_AUDIT_ACTIONS.documentVersionCreated,
      entityType: "document_version",
      entityId: created.id,
      after: {
        document_id: created.documentId,
        version: created.version,
        file_object_id: created.fileObjectId,
        notes: created.notes,
      },
    });

    return created;
  });
}
