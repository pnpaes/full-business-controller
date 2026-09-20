import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { OPTION_KIND } from "@aquarela/persistence";

import { isDecimalString, readText } from "../imports/validation";

export {
  assertIsoDate,
  assertIsoInstant,
  datePartOf,
  isDecimalString,
} from "../imports/validation";

/** Rate scale for `applied_tax_rate` (`numeric(9,6)`). */
export const RATE_SCALE = 6;

const OPTION_KINDS: readonly string[] = OPTION_KIND;

/** A trimmed, non-blank text value, or null. */
export function readUuidOrNull(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = readText(source, key);
  return value === null ? null : value;
}

/**
 * A decimal value at `scale`, normalized with HALF_UP. Absent → null; present
 * but not a plain decimal → `DomainError` (row 11 validation should already have
 * flagged it, so this is a defensive guard that aborts the whole posting).
 */
function readDecimalOrNull(
  source: Readonly<Record<string, unknown>>,
  key: string,
  scale: number,
): string | null {
  const value = readText(source, key);
  if (value === null) {
    return null;
  }
  if (!isDecimalString(value)) {
    throw new DomainError(`normalized ${key} is not a decimal string`);
  }
  return formatDecimal(parseDecimal(value, scale), scale);
}

/** numeric(19,4). */
export function readMoneyOrNull(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return readDecimalOrNull(source, key, MONEY_SCALE);
}

/** numeric(19,6). */
export function readQuantityOrNull(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return readDecimalOrNull(source, key, QUANTITY_SCALE);
}

/** numeric(9,6); captured verbatim when valid (`DEC-045` never re-derives it). */
export function readRateOrNull(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return readDecimalOrNull(source, key, RATE_SCALE);
}

/**
 * `sales_line.option_kind` (`DEC-043`): `standalone` by default, otherwise must
 * be one of the vocabulary values. An unknown value is rejected rather than
 * silently normalized.
 */
export function readOptionKind(source: Readonly<Record<string, unknown>>): string {
  const value = readText(source, "option_kind");
  if (value === null) {
    return "standalone";
  }
  if (!OPTION_KINDS.includes(value)) {
    throw new DomainError(`unknown option_kind "${value}"`);
  }
  return value;
}
