import { DomainError, MONEY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";

export { assertIsoInstant, isBlank } from "../inventory/validation";

/** Soft form of `assertIsoInstant`: true when the value is a full ISO instant. */
export function isIsoInstant(value: string): boolean {
  try {
    assertIsoInstant(value, "value");
    return true;
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `import_run.period_start`/`period_end` are `date` columns (`yyyy-mm-dd`). */
export function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError(`${field} must be an ISO date (yyyy-mm-dd)`);
  }
}

/** The `yyyy-mm-dd` date part of a full ISO instant, or null when unparsable. */
export function datePartOf(value: string): string | null {
  return ISO_DATE.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

/** A jsonb object (not null, not an array) — the shape both staging columns must have. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The per-source validation rules carried by an `import_profile` (`DEC-081`).
 * This is the single source of truth for the shape: the run resolves it from
 * its profile (or from the caller when there is no profile), and an explicit
 * caller rule overrides the profile field-by-field.
 */
export interface ImportValidationRules {
  /** Normalized keys that must be present and non-blank. */
  readonly requiredNormalizedFields?: readonly string[];
  /** The currency every row must carry (`ISO 4217`). */
  readonly expectedCurrency?: string;
  /** Fail rows with no `currency` when `expectedCurrency` is set. */
  readonly requireCurrency?: boolean;
  /** External location ids the run accepts; anything else is `unknown_location`. */
  readonly allowedLocationExternalIds?: readonly string[];
  /** Fail rows with no `occurred_at` (period validation is otherwise skipped). */
  readonly requireOccurredAt?: boolean;
  /** Fail rows with no `gross_amount`; `net_amount`/`tax_amount` are validated when present. */
  readonly requireAmounts?: boolean;
}

function parseStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new DomainError(`${field} must be an array of non-empty strings`);
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new DomainError(`${field} must be an array of non-empty strings`);
    }
    const trimmed = entry.trim();
    if (trimmed === "") {
      throw new DomainError(`${field} must be an array of non-empty strings`);
    }
    entries.push(trimmed);
  }
  return entries;
}

/**
 * Parses a stored `import_profile.validation_rules` jsonb value **fail-closed**:
 * a non-object, a wrongly typed known key or a non-string list entry is a
 * `DomainError` rather than being silently dropped. Unknown keys are ignored and
 * only present keys are returned, so a future key neither breaks nor leaks.
 */
export function parseImportValidationRules(value: unknown): ImportValidationRules {
  if (!isPlainObject(value)) {
    throw new DomainError("import validation rules must be a jsonb object");
  }
  const rules: {
    requiredNormalizedFields?: readonly string[];
    expectedCurrency?: string;
    requireCurrency?: boolean;
    allowedLocationExternalIds?: readonly string[];
    requireOccurredAt?: boolean;
    requireAmounts?: boolean;
  } = {};

  if (value.requiredNormalizedFields !== undefined) {
    rules.requiredNormalizedFields = parseStringArray(
      value.requiredNormalizedFields,
      "requiredNormalizedFields",
    );
  }
  if (value.allowedLocationExternalIds !== undefined) {
    rules.allowedLocationExternalIds = parseStringArray(
      value.allowedLocationExternalIds,
      "allowedLocationExternalIds",
    );
  }
  if (value.expectedCurrency !== undefined) {
    if (typeof value.expectedCurrency !== "string" || value.expectedCurrency.trim() === "") {
      throw new DomainError("expectedCurrency must be a non-empty string");
    }
    rules.expectedCurrency = value.expectedCurrency;
  }
  if (value.requireCurrency !== undefined) {
    if (typeof value.requireCurrency !== "boolean") {
      throw new DomainError("requireCurrency must be a boolean");
    }
    rules.requireCurrency = value.requireCurrency;
  }
  if (value.requireOccurredAt !== undefined) {
    if (typeof value.requireOccurredAt !== "boolean") {
      throw new DomainError("requireOccurredAt must be a boolean");
    }
    rules.requireOccurredAt = value.requireOccurredAt;
  }
  if (value.requireAmounts !== undefined) {
    if (typeof value.requireAmounts !== "boolean") {
      throw new DomainError("requireAmounts must be a boolean");
    }
    rules.requireAmounts = value.requireAmounts;
  }
  return rules;
}

/** True for a plain base-10 decimal string (no exponent, no thousands separators). */
export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value.trim());
}

/** The trimmed text value of a jsonb key, or null when absent/blank/non-text. */
export function readText(source: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = source[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** The numeric value of a jsonb key, or null when absent/non-numeric. */
export function readNumber(source: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface MoneyEntry {
  readonly currency: string;
  readonly amount: string;
}

/** Per-currency sums at money scale (`numeric(19,4)`; never floats). */
export type MoneyTotals = Readonly<Record<string, string>>;

export function sumMoney(entries: readonly MoneyEntry[]): MoneyTotals {
  const units = new Map<string, bigint>();
  for (const entry of entries) {
    if (!isDecimalString(entry.amount)) {
      continue;
    }
    const current = units.get(entry.currency) ?? 0n;
    units.set(entry.currency, current + parseDecimal(entry.amount, MONEY_SCALE));
  }
  return Object.fromEntries(
    [...units.entries()].map(([currency, value]) => [currency, formatDecimal(value, MONEY_SCALE)]),
  );
}

/** `from - minus` per currency, over the union of both key sets. */
export function subtractMoney(from: MoneyTotals, minus: MoneyTotals): MoneyTotals {
  const currencies = new Set([...Object.keys(from), ...Object.keys(minus)]);
  const result: Record<string, string> = {};
  for (const currency of currencies) {
    const left = from[currency] ?? "0";
    const right = minus[currency] ?? "0";
    result[currency] = formatDecimal(
      parseDecimal(left, MONEY_SCALE) - parseDecimal(right, MONEY_SCALE),
      MONEY_SCALE,
    );
  }
  return result;
}
