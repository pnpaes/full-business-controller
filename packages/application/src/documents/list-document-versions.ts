import type { DocumentVersionRecord, DocumentsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_DOCUMENT_VERSION_LIMIT = 50;

export interface ListDocumentVersionsQuery {
  readonly organizationId: string;
  readonly documentId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The versions of one document for one organization. The organization filter is
 * never optional, so a caller cannot read another tenant's history (`DEC-061`);
 * `limit` defaults to `DEFAULT_DOCUMENT_VERSION_LIMIT` so a caller cannot ask
 * for the whole history unbounded.
 */
export async function listDocumentVersions(
  store: DocumentsStore,
  query: ListDocumentVersionsQuery,
): Promise<readonly DocumentVersionRecord[]> {
  return store.listDocumentVersions({
    organizationId: query.organizationId,
    documentId: query.documentId,
    limit: query.limit ?? DEFAULT_DOCUMENT_VERSION_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
