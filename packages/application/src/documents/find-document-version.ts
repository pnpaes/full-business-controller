import type { DocumentVersionRecord, DocumentsStore } from "./types";

export interface FindDocumentVersionQuery {
  readonly organizationId: string;
  readonly documentVersionId: string;
}

/**
 * One document version by id, organization-scoped (`DEC-061`), or `undefined`.
 * A missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of a version outside its organization.
 */
export async function findDocumentVersion(
  store: DocumentsStore,
  query: FindDocumentVersionQuery,
): Promise<DocumentVersionRecord | undefined> {
  return store.findDocumentVersion({
    organizationId: query.organizationId,
    documentVersionId: query.documentVersionId,
  });
}
