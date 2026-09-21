import { DomainError } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";

export { assertIsoInstant };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Effective-dated columns are PostgreSQL `date` columns carried as
 * `yyyy-mm-dd` strings (see `normaliseDate` in the persistence repositories), so
 * a command must reject anything that is not one before it reaches the store.
 */
export function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value)) {
    throw new DomainError(`${field} must be an ISO date (yyyy-mm-dd)`);
  }
}

export function assertOptionalIsoDate(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  assertIsoDate(value, field);
}

/** Asserts both dates are ISO and, when present, that `effectiveTo` is strictly after `effectiveFrom`. */
export function assertEffectiveRange(from: string, to: string | null | undefined): void {
  assertIsoDate(from, "effectiveFrom");
  assertOptionalIsoDate(to, "effectiveTo");
  if (to !== null && to !== undefined && to <= from) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }
}

/**
 * The `timestamptz` counterpart of `assertEffectiveRange`: both values must be
 * ISO-8601 instants and, when `to` is present, strictly after `from`. Compared
 * by parsed time, so an offset or differing precision cannot invert the order.
 */
export function assertInstantRange(from: string, to: string | null | undefined): void {
  assertIsoInstant(from, "effectiveFrom");
  if (to === null || to === undefined) {
    return;
  }
  assertIsoInstant(to, "effectiveTo");
  if (Date.parse(to) <= Date.parse(from)) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }
}
