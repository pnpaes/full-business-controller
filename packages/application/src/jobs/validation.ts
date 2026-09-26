import { DomainError } from "@aquarela/domain";

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

export function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) {
    throw new DomainError(`${field} must be a UUID`);
  }
}

/** A positive integer attempt number (`>= 1`); anything else is a `DomainError`. */
export function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError(`${field} must be a positive integer`);
  }
  return value;
}
