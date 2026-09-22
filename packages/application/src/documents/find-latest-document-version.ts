import type { DocumentVersionRecord, DocumentsStore } from "./types";

export interface FindLatestDocumentVersionQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/**
 * The document's highest-numbered version, organization-scoped (`DEC-061`), or
 * `undefined` when the document has no versions yet. This is the version a new
 * version numbers after and the candidate current published version (`DEC-088`).
 */
export async function findLatestDocumentVersion(
  store: DocumentsStore,
  query: FindLatestDocumentVersionQuery,
): Promise<DocumentVersionRecord | undefined> {
  return store.findLatestDocumentVersion({
    organizationId: query.organizationId,
    documentId: query.documentId,
  });
}
