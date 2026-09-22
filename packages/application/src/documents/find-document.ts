import type { DocumentRecord, DocumentsStore } from "./types";

export interface FindDocumentQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/**
 * One document by id, organization-scoped (`DEC-061`), or `undefined`. A missing
 * id and another tenant's id are indistinguishable, so a caller cannot probe for
 * the existence of a document outside its organization.
 */
export async function findDocument(
  store: DocumentsStore,
  query: FindDocumentQuery,
): Promise<DocumentRecord | undefined> {
  return store.findDocument({
    organizationId: query.organizationId,
    documentId: query.documentId,
  });
}
