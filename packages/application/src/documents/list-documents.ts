import { DomainError } from "@aquarela/domain";

import { DOCUMENT_AUDIENCES, DOCUMENT_CATEGORIES } from "./create-document";
import type { DocumentRecord, DocumentsStore } from "./types";
import { DOCUMENT_STATUSES } from "./update-document";

/** Page size when the caller does not ask for one. */
export const DEFAULT_DOCUMENT_LIMIT = 50;

export interface ListDocumentsQuery {
  readonly organizationId: string;
  /** One of `DOCUMENT_CATEGORY`, exact match. */
  readonly category?: string;
  /** One of `DOCUMENT_AUDIENCE`, exact match. */
  readonly audience?: string;
  /** One of `STAFF_DOCUMENT_STATUS`, exact match. */
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Documents for one organization, with optional category, audience and status
 * filters. The organization filter is never optional, so a caller cannot read
 * another tenant's library (`DEC-061`); `limit` defaults to
 * `DEFAULT_DOCUMENT_LIMIT` so a caller cannot ask for the whole library
 * unbounded.
 *
 * A supplied filter value is validated against its vocabulary
 * (`document_category_check`/`document_audience_check`/`document_status_check`
 * counterparts), so an unknown value is a `DomainError` rather than a silently
 * empty page.
 */
export async function listDocuments(
  store: DocumentsStore,
  query: ListDocumentsQuery,
): Promise<readonly DocumentRecord[]> {
  if (query.category !== undefined) {
    const category = query.category.trim();
    if (!DOCUMENT_CATEGORIES.includes(category)) {
      throw new DomainError(`category must be one of ${DOCUMENT_CATEGORIES.join(", ")}`);
    }
  }
  if (query.audience !== undefined) {
    const audience = query.audience.trim();
    if (!DOCUMENT_AUDIENCES.includes(audience)) {
      throw new DomainError(`audience must be one of ${DOCUMENT_AUDIENCES.join(", ")}`);
    }
  }
  if (query.status !== undefined) {
    const status = query.status.trim();
    if (!DOCUMENT_STATUSES.includes(status)) {
      throw new DomainError(`status must be one of ${DOCUMENT_STATUSES.join(", ")}`);
    }
  }

  return store.listDocuments({
    organizationId: query.organizationId,
    ...(query.category === undefined ? {} : { category: query.category.trim() }),
    ...(query.audience === undefined ? {} : { audience: query.audience.trim() }),
    ...(query.status === undefined ? {} : { status: query.status.trim() }),
    limit: query.limit ?? DEFAULT_DOCUMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
