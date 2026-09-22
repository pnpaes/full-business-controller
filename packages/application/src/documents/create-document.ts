import { DomainError } from "@aquarela/domain";
import { DOCUMENT_AUDIENCE, DOCUMENT_CATEGORY } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { DOCUMENT_AUDIT_ACTIONS } from "./actions";
import type { DocumentRecord, DocumentsStore } from "./types";

/** The `document_category` vocabulary a document may hold (`DOCUMENT_CATEGORY`). */
export const DOCUMENT_CATEGORIES: readonly string[] = DOCUMENT_CATEGORY;

/** The `document_audience` vocabulary a document may target (`DOCUMENT_AUDIENCE`). */
export const DOCUMENT_AUDIENCES: readonly string[] = DOCUMENT_AUDIENCE;

export interface CreateDocumentInput {
  readonly organizationId: string;
  readonly title: string;
  /** One of `DOCUMENT_CATEGORY` (routine/guideline/policy/form/other). */
  readonly category: string;
  /** One of `DOCUMENT_AUDIENCE` (all_staff/managers). */
  readonly audience: string;
  /** Plain uuid; the `app_user` FK is deferred. */
  readonly ownerId?: string | null;
  readonly actorId: string;
}

/**
 * Creates one staff document (`DOC-001`, `DEC-088`): validates the non-blank
 * `title` and the `category`/`audience` vocabularies, then creates the row and
 * its audit fact in one transaction. The create is organization-scoped through
 * `input.organizationId` (`DEC-061`).
 *
 * A new document always starts `draft` (`staff_document_status`): publication is
 * a version-level fact, so it is never chosen at creation. `category` and
 * `audience` are database-backed checks
 * (`document_category_check`/`document_audience_check`), mirrored here so the
 * fake-store unit suite and the API see one error class (`DomainError`) rather
 * than a driver constraint violation.
 */
export async function createDocument(
  store: DocumentsStore,
  input: CreateDocumentInput,
): Promise<DocumentRecord> {
  if (isBlank(input.title)) {
    throw new DomainError("title is required");
  }
  if (isBlank(input.category)) {
    throw new DomainError("category is required");
  }
  const category = input.category.trim();
  if (!DOCUMENT_CATEGORIES.includes(category)) {
    throw new DomainError(`category must be one of ${DOCUMENT_CATEGORIES.join(", ")}`);
  }
  if (isBlank(input.audience)) {
    throw new DomainError("audience is required");
  }
  const audience = input.audience.trim();
  if (!DOCUMENT_AUDIENCES.includes(audience)) {
    throw new DomainError(`audience must be one of ${DOCUMENT_AUDIENCES.join(", ")}`);
  }

  return store.withTransaction(async (tx) => {
    const document = await tx.createDocument({
      organizationId: input.organizationId,
      title: input.title.trim(),
      category,
      audience,
      status: "draft",
      ownerId: input.ownerId ?? null,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: DOCUMENT_AUDIT_ACTIONS.documentCreated,
      entityType: "document",
      entityId: document.id,
      after: {
        title: document.title,
        category: document.category,
        audience: document.audience,
        status: document.status,
        owner_id: document.ownerId,
      },
    });

    return document;
  });
}
