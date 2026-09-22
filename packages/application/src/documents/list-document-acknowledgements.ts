import type { DocumentAcknowledgementRecord, DocumentsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT = 50;

export interface ListDocumentAcknowledgementsQuery {
  readonly organizationId: string;
  /** Scopes the read to one document's versions. */
  readonly documentId?: string;
  readonly documentVersionId?: string;
  readonly acknowledgedBy?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Acknowledgement facts for one organization, with optional document, version
 * and user filters. The organization filter is never optional, so a caller
 * cannot read another tenant's facts (`DEC-061`); `limit` defaults to
 * `DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT` so a caller cannot ask for the whole
 * log unbounded.
 */
export async function listDocumentAcknowledgements(
  store: DocumentsStore,
  query: ListDocumentAcknowledgementsQuery,
): Promise<readonly DocumentAcknowledgementRecord[]> {
  return store.listDocumentAcknowledgements({
    organizationId: query.organizationId,
    ...(query.documentId === undefined ? {} : { documentId: query.documentId }),
    ...(query.documentVersionId === undefined
      ? {}
      : { documentVersionId: query.documentVersionId }),
    ...(query.acknowledgedBy === undefined ? {} : { acknowledgedBy: query.acknowledgedBy }),
    limit: query.limit ?? DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
