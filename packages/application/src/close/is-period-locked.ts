import type { PeriodCloseRecord, PeriodCloseScopeType, PeriodCloseStore } from "./types";

export interface IsPeriodLockedQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: PeriodCloseScopeType;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly at: string;
}

/** The lock answer for one scope and date (`REC-006`). */
export interface PeriodLockResult {
  readonly locked: boolean;
  /** The locking close, present exactly when `locked` is true. */
  readonly periodClose?: PeriodCloseRecord;
}

/**
 * Whether a scope is locked at a date (`REC-006`): true when a `locked`
 * `period_close` row for the organization and scope contains `at` (inclusive
 * bounds). This is a **read** and writes no audit fact. A `closing`/`reopened`/
 * `open` row locks nothing, so only `locked` matches.
 */
export async function isPeriodLocked(
  store: PeriodCloseStore,
  query: IsPeriodLockedQuery,
): Promise<PeriodLockResult> {
  const record = await store.findLockedPeriodCloseCoveringDate({
    organizationId: query.organizationId,
    scopeType: query.scopeType,
    scopeId: query.scopeId,
    at: query.at,
  });
  return record === undefined ? { locked: false } : { locked: true, periodClose: record };
}
