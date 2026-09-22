import { DomainError, NotFoundError } from "@aquarela/domain";
import { STAFF_DOCUMENT_STATUS } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { DOCUMENT_AUDIT_ACTIONS } from "./actions";
import { DOCUMENT_AUDIENCES, DOCUMENT_CATEGORIES } from "./create-document";
import type { DocumentRecord, DocumentsStore } from "./types";

/** The `staff_document_status` vocabulary a document may hold (`STAFF_DOCUMENT_STATUS`). */
export const DOCUMENT_STATUSES: readonly string[] = STAFF_DOCUMENT_STATUS;

export interface UpdateDocumentInput {
  readonly organizationId: string;
  readonly documentId: string;
  /** Non-empty; trimmed. Omitted leaves the title unchanged. */
  readonly title?: string;
  /** One of `DOCUMENT_CATEGORY`. Omitted leaves it unchanged. */
  readonly category?: string;
  /** One of `DOCUMENT_AUDIENCE`. Omitted leaves it unchanged. */
  readonly audience?: string;
  /** Omitted leaves it unchanged; `null` clears it. */
  readonly ownerId?: string | null;
  /**
   * Only `archived` is accepted (`draft`/`published` are rejected — a document
   * is published through one of its versions). Archiving an already-archived
   * document is a true no-op.
   */
  readonly status?: string;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  title: "title",
  category: "category",
  audience: "audience",
  ownerId: "owner_id",
  status: "status",
} as const;

/**
 * Amends one staff document (`DOC-001`, `DEC-088`). The row is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `title` stays non-blank
 * and `category`/`audience` stay in their vocabularies.
 *
 * `status` is deliberately narrow: the only value a caller may set is
 * `archived` (a `draft`/`published` status is a `DomainError`, because
 * publication happens through a version, not the document). Archiving an
 * already-archived document is a **true no-op** — the current row is returned
 * with no write and no audit fact (the `retireEmployee` precedent), so a retry
 * cannot manufacture a spurious `documents.document.updated` fact. An empty
 * patch is rejected. The update and its audit fact commit or roll back together.
 */
export async function updateDocument(
  store: DocumentsStore,
  input: UpdateDocumentInput,
): Promise<DocumentRecord> {
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

    const mutable: {
      title?: string;
      category?: string;
      audience?: string;
      ownerId?: string | null;
      status?: string;
    } = {};

    if (input.title !== undefined) {
      if (isBlank(input.title)) {
        throw new DomainError("title is required");
      }
      mutable.title = input.title.trim();
    }
    if (input.category !== undefined) {
      if (isBlank(input.category)) {
        throw new DomainError("category is required");
      }
      const category = input.category.trim();
      if (!DOCUMENT_CATEGORIES.includes(category)) {
        throw new DomainError(`category must be one of ${DOCUMENT_CATEGORIES.join(", ")}`);
      }
      mutable.category = category;
    }
    if (input.audience !== undefined) {
      if (isBlank(input.audience)) {
        throw new DomainError("audience is required");
      }
      const audience = input.audience.trim();
      if (!DOCUMENT_AUDIENCES.includes(audience)) {
        throw new DomainError(`audience must be one of ${DOCUMENT_AUDIENCES.join(", ")}`);
      }
      mutable.audience = audience;
    }
    if (input.ownerId !== undefined) {
      mutable.ownerId = input.ownerId;
    }

    const status = input.status;
    if (status !== undefined && status.trim() !== "archived") {
      throw new DomainError('status may only be set to "archived"');
    }
    // Already archived with nothing else to change: return the row untouched and
    // write no audit fact. A repeat archive must be a no-op, not another state
    // change, and must not bump `updated_at`.
    if (
      status !== undefined &&
      document.status === "archived" &&
      Object.keys(mutable).length === 0
    ) {
      return document;
    }
    if (status !== undefined && document.status !== "archived") {
      mutable.status = "archived";
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateDocument({
      organizationId: input.organizationId,
      documentId: document.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("document not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = document[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: DOCUMENT_AUDIT_ACTIONS.documentUpdated,
      entityType: "document",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
