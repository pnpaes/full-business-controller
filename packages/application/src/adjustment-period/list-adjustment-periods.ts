import { DomainError } from "@aquarela/domain";

import { ADJUSTMENT_PERIOD_STATUSES } from "./types";
import type { AdjustmentPeriodRecord, AdjustmentPeriodStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_ADJUSTMENT_PERIOD_LIMIT = 50;

export interface ListAdjustmentPeriodsQuery {
  readonly organizationId: string;
  /** One of `ADJUSTMENT_PERIOD_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `opened_from`; `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `opened_from`; `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Adjustment periods for one organization, newest window first, with optional
 * status and `opened_from` filters. The organization filter is never optional, so
 * a caller cannot read another tenant's periods (`DEC-061`); a provided `status`
 * is checked against the vocabulary here so a bogus filter is a `DomainError`
 * rather than a silently empty page; `limit` defaults to
 * `DEFAULT_ADJUSTMENT_PERIOD_LIMIT` so a caller cannot ask for every period
 * unbounded.
 */
export async function listAdjustmentPeriods(
  store: AdjustmentPeriodStore,
  query: ListAdjustmentPeriodsQuery,
): Promise<readonly AdjustmentPeriodRecord[]> {
  if (query.status !== undefined && !ADJUSTMENT_PERIOD_STATUSES.includes(query.status)) {
    throw new DomainError(`status must be one of ${ADJUSTMENT_PERIOD_STATUSES.join(", ")}`);
  }

  return store.listAdjustmentPeriods({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_ADJUSTMENT_PERIOD_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
