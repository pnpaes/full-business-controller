import { DomainError } from "@aquarela/domain";

import { SHIFT_STATES } from "./types";
import type { SchedulingStore, ShiftRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_SHIFT_LIMIT = 50;

export interface ListShiftsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** One of `SHIFT_STATES`, exact match. */
  readonly state?: string;
  /** Inclusive lower bound on `starts_at`; an ISO instant. */
  readonly from?: string;
  /** Inclusive upper bound on `starts_at`; an ISO instant. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shifts for one organization, with optional location, state and
 * `starts_at`-window filters. The organization filter is never optional, so a
 * caller cannot read another tenant's rota (`DEC-061`); a provided `state` is
 * checked against `SHIFT_STATES` here so a bogus filter is a `DomainError`
 * rather than a silently empty page; `limit` defaults to `DEFAULT_SHIFT_LIMIT`
 * so a caller cannot ask for the whole rota unbounded.
 */
export async function listShifts(
  store: SchedulingStore,
  query: ListShiftsQuery,
): Promise<readonly ShiftRecord[]> {
  if (query.state !== undefined && !SHIFT_STATES.includes(query.state)) {
    throw new DomainError(`state must be one of ${SHIFT_STATES.join(", ")}`);
  }

  return store.listShifts({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.state === undefined ? {} : { state: query.state }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_SHIFT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
