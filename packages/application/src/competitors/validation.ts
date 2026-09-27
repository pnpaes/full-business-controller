import {
  DomainError,
  MONEY_SCALE,
  formatDecimal,
  normalizeCurrency,
  parseDecimal,
} from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";

export { assertIsoInstant };

/** The same strict 8-4-4-4-12 UUID the API routes accept. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Trims `value` and rejects a blank result, so commands store canonical text. */
export function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError(`${field} is required`);
  }
  return trimmed;
}

/** Trims an optional text field; a blank result becomes `null`. */
export function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) {
    throw new DomainError(`${field} must be a UUID`);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Asserts `value` is an ISO calendar date (`YYYY-MM-DD`) that actually parses.
 * Returns the value so a caller can use the assertion as a normaliser.
 */
export function assertIsoDate(value: string, field: string): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

/** Asserts `value` is one of `allowed`; returns it. A closed vocabulary never drifts. */
export function assertEnumValue(value: string, allowed: readonly string[], field: string): string {
  if (!allowed.includes(value)) {
    throw new DomainError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value;
}

/** An optional jsonb object; absent/`null` → `{}`; a non-object is a `DomainError`. */
export function optionalRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function assertOptionalUuid(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  assertUuid(value, field);
}

/**
 * Normalises a given ISO-4217 currency (upper-cased) via the domain helper; a
 * non-3-letter value is a `DomainError`. `null`/absent stays `null`.
 */
export function optionalCurrency(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  return normalizeCurrency(value);
}

/**
 * Parses an optional price as a non-negative `numeric(19,4)` decimal string.
 * A negative, malformed or out-of-scale value is a `DomainError`, so the sign is
 * never accepted from the caller.
 */
export function optionalNonNegativePrice(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  let scaled: bigint;
  try {
    scaled = parseDecimal(value, MONEY_SCALE);
  } catch {
    throw new DomainError(`${field} must be a decimal money amount`);
  }
  if (scaled < 0n) {
    throw new DomainError(`${field} must not be negative`);
  }
  return formatDecimal(scaled, MONEY_SCALE);
}
