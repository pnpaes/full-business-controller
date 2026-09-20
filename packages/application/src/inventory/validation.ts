import { DomainError } from "@aquarela/domain";

/**
 * A full ISO-8601 instant with a date, time and zone (`Z` or `±hh:mm`).
 * `Date.parse` alone accepts date-only and locale strings the ledger must not
 * treat as an economic timestamp, so both the shape and the parse are checked.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `timestamptz` columns are carried as ISO instants; reject anything else up front. */
export function assertIsoInstant(value: string, field: string): void {
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DomainError(`${field} must be an ISO-8601 instant`);
  }
}

/** True for null/undefined/whitespace-only text: the required-text check shared by the commands. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}
