import { DomainError, STOCK_QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";

/** The same strict 8-4-4-4-12 UUID the API routes and `uuidOrNotFound` accept. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Parses a caller-supplied quantity as a positive numeric(19,6) magnitude and
 * returns its scaled integer. Zero, negative, malformed or out-of-scale values
 * are rejected, so the sign is always set by the command, never the caller.
 */
export function parsePositiveQuantity(value: string, field: string): bigint {
  let scaled: bigint;
  try {
    scaled = parseDecimal(value, STOCK_QUANTITY_SCALE);
  } catch {
    throw new DomainError(`${field} must be a decimal quantity`);
  }
  if (scaled <= 0n) {
    throw new DomainError(`${field} must be greater than zero`);
  }
  return scaled;
}
