import { DomainError } from "@aquarela/domain";

import { PERIOD_CLOSE_SCOPE_TYPES, PERIOD_CLOSE_STATUSES } from "./types";
import type { PeriodCloseRecord, PeriodCloseStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_PERIOD_CLOSE_LIMIT = 50;

export interface ListPeriodClosesQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`, exact match. */
  readonly scopeType?: string;
  readonly scopeId?: string;
  /** One of `PERIOD_CLOSE_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start`; `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `period_start`; `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Closes for one organization, newest period first, with optional scope, status
 * and period-start filters. The organization filter is never optional, so a
 * caller cannot read another tenant's closes (`DEC-061`); a provided `status` or
 * `scopeType` is checked against the vocabularies here so a bogus filter is a
 * `DomainError` rather than a silently empty page; `limit` defaults to
 * `DEFAULT_PERIOD_CLOSE_LIMIT` so a caller cannot ask for every close unbounded.
 */
export async function listPeriodCloses(
  store: PeriodCloseStore,
  query: ListPeriodClosesQuery,
): Promise<readonly PeriodCloseRecord[]> {
  if (query.status !== undefined && !PERIOD_CLOSE_STATUSES.includes(query.status)) {
    throw new DomainError(`status must be one of ${PERIOD_CLOSE_STATUSES.join(", ")}`);
  }
  if (query.scopeType !== undefined && !PERIOD_CLOSE_SCOPE_TYPES.includes(query.scopeType)) {
    throw new DomainError(`scopeType must be one of ${PERIOD_CLOSE_SCOPE_TYPES.join(", ")}`);
  }

  return store.listPeriodCloses({
    organizationId: query.organizationId,
    ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
    ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_PERIOD_CLOSE_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
