import type { DocumentVersionRecord, DocumentsStore } from "./types";

export interface FindCurrentPublishedVersionQuery {
  readonly organizationId: string;
  readonly documentId: string;
}

/**
 * The document's greatest **published** version, organization-scoped
 * (`DEC-061`), or `undefined` when the document has no published version
 * (`DOC-002`). This is the version visible to staff: a newer unpublished version
 * does not shadow it, unlike `findLatestDocumentVersion`.
 */
export async function findCurrentPublishedVersion(
  store: DocumentsStore,
  query: FindCurrentPublishedVersionQuery,
): Promise<DocumentVersionRecord | undefined> {
  return store.findCurrentPublishedVersion({
    organizationId: query.organizationId,
    documentId: query.documentId,
  });
}
