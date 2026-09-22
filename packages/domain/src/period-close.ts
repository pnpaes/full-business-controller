import { DomainError } from "./errors";

/**
 * Pure domain logic for the close/lock slice (`REC-003`, `REC-006`, `DEC-027`,
 * row 13a). Nothing here touches the database or a decimal: a close period is a
 * pair of calendar days, the checklist is a small jsonb array and the snapshot is
 * a frozen JSON object of strings/booleans only (no floats).
 *
 * The scope and status vocabularies mirror the persistence
 * `period_close_scope_type`/`period_close_status` arrays. The domain layer must
 * not import persistence, so the arrays are kept local here; the
 * `schemas/domain-enums.yaml` key is the single authority both mirror (see
 * `DEC-105`).
 */

/** The `period_close_scope_type` vocabulary (`DEC-027`). */
export const PERIOD_CLOSE_SCOPE_TYPES = ["location", "company"] as const;

/** The `period_close_status` vocabulary (`DEC-027`; provisional, `DEC-105`). */
export const PERIOD_CLOSE_STATUSES = ["open", "closing", "locked", "reopened"] as const;

export type PeriodCloseScopeType = (typeof PERIOD_CLOSE_SCOPE_TYPES)[number];

export type PeriodCloseStatus = (typeof PERIOD_CLOSE_STATUSES)[number];

/** The shape version of the stored `period_close.snapshot` jsonb. */
export const PERIOD_CLOSE_SNAPSHOT_VERSION = 1;

/** A `date` column's wire form: `YYYY-MM-DD` with no time part. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `date` columns are carried as `YYYY-MM-DD`. The regex alone accepts an
 * impossible day such as `2026-02-31`, which would reach Postgres as a driver
 * error rather than a `DomainError`, so the day is round-tripped through `Date`
 * too (the `assertOptionalCalendarDate` precedent).
 */
function assertCalendarDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError(`${field} must be a date (YYYY-MM-DD)`);
  }
}

/** The last day of `value`'s UTC calendar month, where `value` is the first day. */
function lastDayOfUtcMonth(firstDay: string): string {
  const year = Number.parseInt(firstDay.slice(0, 4), 10);
  const month = Number.parseInt(firstDay.slice(5, 7), 10);
  // `Date.UTC(year, month, 0)` is day 0 of the following month = the last day of
  // this one; `month` is 1-based here, which is exactly the 0-based next index.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The resolved period of one close scope (`DEC-027`). */
export interface ClosePeriod {
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
}

/**
 * Resolves the period of one close scope from its `periodStart` (`DEC-027`):
 * a `location` scope is a **single day** (`periodEnd = periodStart`); a `company`
 * scope must start on the **first day of its UTC calendar month** and ends on
 * that month's last day. Any other scope, a malformed day, or a company start
 * that is not a month's first day is a `DomainError`.
 */
export function resolveClosePeriod(scopeType: string, periodStart: string): ClosePeriod {
  if (!(PERIOD_CLOSE_SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    throw new DomainError(`scopeType must be one of ${PERIOD_CLOSE_SCOPE_TYPES.join(", ")}`);
  }
  assertCalendarDate(periodStart, "periodStart");

  if (scopeType === "location") {
    return { periodStart, periodEnd: periodStart };
  }

  if (periodStart.slice(8, 10) !== "01") {
    throw new DomainError("company scope periodStart must be the first day of its calendar month");
  }
  return { periodStart, periodEnd: lastDayOfUtcMonth(periodStart) };
}

/** One close-task item: a stable `key`, a human `label` and a completion flag. */
export interface CloseChecklistItem {
  readonly key: string;
  readonly label: string;
  readonly done: boolean;
}

/**
 * Validates the `period_close.checklist` value: a (possibly empty) array of
 * objects each carrying a non-empty string `key` and `label` and a boolean
 * `done`. Extra keys on an item pass through untouched. A non-array, a non-object
 * item or a malformed field is a `DomainError`.
 */
export function assertCloseChecklist(value: unknown): readonly CloseChecklistItem[] {
  if (!Array.isArray(value)) {
    throw new DomainError("checklist must be an array");
  }
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new DomainError(`checklist[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const key = record["key"];
    const label = record["label"];
    const done = record["done"];
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new DomainError(`checklist[${index}].key must be a non-empty string`);
    }
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new DomainError(`checklist[${index}].label must be a non-empty string`);
    }
    if (typeof done !== "boolean") {
      throw new DomainError(`checklist[${index}].done must be a boolean`);
    }
    // Spread first so any extra item keys are preserved (they pass through).
    return { ...record, key, label, done };
  });
}

/** The frozen, reproducible contents of a close. */
export interface CloseSnapshot {
  readonly schemaVersion: number;
  readonly scopeType: PeriodCloseScopeType;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  /** `timestamptz`, ISO; when the snapshot was captured. */
  readonly capturedAt: string;
  readonly checklist: readonly CloseChecklistItem[];
}

export interface BuildCloseSnapshotInput {
  readonly scopeType: PeriodCloseScopeType;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  /** `timestamptz`, ISO. */
  readonly capturedAt: string;
  readonly checklist: readonly CloseChecklistItem[];
}

/**
 * Builds the frozen close snapshot: the schema version, the scope and period,
 * the capture instant and the checklist. Everything is a string, a boolean or an
 * array — no floats — so the stored jsonb is reproducible and the richer
 * reconciliation/aggregate snapshot stays a deferred concern (`DEC-105`).
 */
export function buildCloseSnapshot(input: BuildCloseSnapshotInput): CloseSnapshot {
  return {
    schemaVersion: PERIOD_CLOSE_SNAPSHOT_VERSION,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    capturedAt: input.capturedAt,
    checklist: input.checklist,
  };
}
