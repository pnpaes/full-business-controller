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
