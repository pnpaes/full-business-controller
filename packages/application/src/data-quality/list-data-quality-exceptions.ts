import { DomainError } from "@aquarela/domain";

import type { DataQualityExceptionReadStore, DataQualityExceptionRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_DATA_QUALITY_EXCEPTION_LIMIT = 200;

export interface ListDataQualityExceptionsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly severity?: string;
  readonly entityType?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Data-quality exceptions for one organization (§7.9), newest `detected_at`
 * first, with optional status/severity/entity-type filters. The organization
 * filter is never optional, so a caller cannot read another tenant's exceptions
 * (`DEC-061`); `limit` defaults to `DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT` and is
 * validated against `MAX_DATA_QUALITY_EXCEPTION_LIMIT` so a caller cannot
 * request the whole register unbounded.
 */
export async function listDataQualityExceptions(
  store: DataQualityExceptionReadStore,
  query: ListDataQualityExceptionsQuery,
): Promise<readonly DataQualityExceptionRecord[]> {
  const limit = query.limit ?? DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DATA_QUALITY_EXCEPTION_LIMIT) {
    throw new DomainError(
      `limit must be an integer between 1 and ${MAX_DATA_QUALITY_EXCEPTION_LIMIT}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  return store.listDataQualityExceptions({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.severity === undefined ? {} : { severity: query.severity }),
    ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
    limit,
    offset,
  });
}
