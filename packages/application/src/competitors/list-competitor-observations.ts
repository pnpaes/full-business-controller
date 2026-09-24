import { DomainError } from "@aquarela/domain";

import { COMPETITOR_REVIEW_STATUSES } from "./types";
import type { CompetitorObservationRecord, CompetitorStore } from "./types";
import { assertIsoInstant, assertOptionalUuid } from "./validation";

/** Page size when the caller does not ask for one. */
export const DEFAULT_COMPETITOR_OBSERVATION_LIMIT = 200;

/**
 * The status an observation read returns when the caller asks for none. The
 * `DEC-126` posture: **only reviewed observations are intelligence**, so the
 * default read is `reviewed`; the pending/rejected rows are visible only behind
 * an explicit filter.
 */
export const COMPETITOR_OBSERVATION_DEFAULT_STATUS = "reviewed";

/** The explicit filter values the read accepts; `all` disables the status filter. */
export type CompetitorObservationStatusFilter = (typeof COMPETITOR_REVIEW_STATUSES)[number] | "all";

export interface ListCompetitorObservationsQuery {
  readonly organizationId: string;
  readonly competitorId?: string;
  /** One of `COMPETITOR_REVIEW_STATUSES`, or `all`. Defaults to `reviewed`. */
  readonly status?: CompetitorObservationStatusFilter;
  /** Lower bound on `observedAt` (`>=`); ISO instant. */
  readonly from?: string;
  /** Upper bound on `observedAt` (`<`); ISO instant — a half-open window. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Observations for one organization, newest `observed_at` first (`DEC-126`).
 *
 * **Defaults to `reviewed`**: a caller that passes no `status` gets only the
 * observations admitted as intelligence, never a pending one. `status: "all"`
 * is the explicit filter that lifts that (the register view), and a specific
 * `pending`/`reviewed`/`rejected` filters to that status. A bogus status is a
 * `DomainError`. The organization filter is never optional (`DEC-061`), the
 * `competitorId`/window filters are checked, and `limit` defaults to
 * `DEFAULT_COMPETITOR_OBSERVATION_LIMIT`.
 */
export async function listCompetitorObservations(
  store: CompetitorStore,
  query: ListCompetitorObservationsQuery,
): Promise<readonly CompetitorObservationRecord[]> {
  const status = query.status ?? COMPETITOR_OBSERVATION_DEFAULT_STATUS;
  if (status !== "all" && !COMPETITOR_REVIEW_STATUSES.includes(status)) {
    throw new DomainError(`status must be one of ${COMPETITOR_REVIEW_STATUSES.join(", ")}, or all`);
  }
  if (query.competitorId !== undefined) {
    assertOptionalUuid(query.competitorId, "competitorId");
  }
  if (query.from !== undefined) {
    assertIsoInstant(query.from, "from");
  }
  if (query.to !== undefined) {
    assertIsoInstant(query.to, "to");
  }
  if (query.from !== undefined && query.to !== undefined && query.to <= query.from) {
    throw new DomainError("to must be after from");
  }

  return store.listObservations({
    organizationId: query.organizationId,
    ...(query.competitorId === undefined ? {} : { competitorId: query.competitorId }),
    ...(status === "all" ? {} : { status }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit: query.limit ?? DEFAULT_COMPETITOR_OBSERVATION_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
