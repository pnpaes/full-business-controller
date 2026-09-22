import { DomainError } from "./errors";
import { IMPORT_RUN_STATUSES } from "./sales-mapping";
import type { ToleranceKind } from "./sales-consumption";

/**
 * Pure domain logic for the close/lock slice (`REC-003`, `REC-006`, `DEC-027`,
 * row 13a). Nothing here touches the database or a decimal: a close period is a
 * pair of calendar days, the checklist is a small jsonb array and the snapshot is
 * a frozen JSON object of strings/numbers/booleans only (no floats).
 *
 * The scope, status and reconciliation-status vocabularies mirror the
 * persistence `period_close_scope_type`/`period_close_status`/
 * `reconciliation_status` arrays. The domain layer must not import persistence, so
 * those arrays are kept local here; the `import_run.status` vocabulary is **not**
 * restated — it is the domain's existing `IMPORT_RUN_STATUSES` (see
 * `CLOSE_IMPORT_STATUSES`). The `schemas/domain-enums.yaml` key is the single
 * authority both mirror (see `DEC-105`, `DEC-107`).
 */

/** The `period_close_scope_type` vocabulary (`DEC-027`). */
export const PERIOD_CLOSE_SCOPE_TYPES = ["location", "company"] as const;

/** The `period_close_status` vocabulary (`DEC-027`; provisional, `DEC-105`). */
export const PERIOD_CLOSE_STATUSES = ["open", "closing", "locked", "reopened"] as const;

export type PeriodCloseScopeType = (typeof PERIOD_CLOSE_SCOPE_TYPES)[number];

export type PeriodCloseStatus = (typeof PERIOD_CLOSE_STATUSES)[number];

/** The `reconciliation.status` vocabulary (mirrors persistence `RECONCILIATION_STATUS`). */
export const CLOSE_RECONCILIATION_STATUSES = [
  "pending",
  "within_tolerance",
  "exception",
  "resolved",
  "approved",
] as const;

/**
 * The `import_run.status` vocabulary for the close. It is the domain's existing
 * `IMPORT_RUN_STATUSES` (`sales-mapping.ts`, mirroring persistence `IMPORT_STATUS`)
 * under a close-facing name — a second literal copy would be free to drift.
 */
export const CLOSE_IMPORT_STATUSES = IMPORT_RUN_STATUSES;

/**
 * The reconciliation statuses that block a close (`DEC-107`): an unresolved
 * reconciliation (`pending`) or one over tolerance still awaiting resolution
 * (`exception`). The blocker prose is built from this array, so a status change
 * cannot drift the message.
 */
export const RECONCILIATION_BLOCKING_STATUSES = ["pending", "exception"] as const;

/**
 * The import-run statuses that block a close (`DEC-107`, extending the
 * `DEC-035`/`DEC-082` "a non-posted row needs a disposition" intent to the
 * period close): every state before a row is fully `posted`, so an
 * `uploaded`/`parsed`/`needs_review`/`validated`/`partially_posted` run is open.
 */
export const IMPORT_RUN_BLOCKING_STATUSES = [
  "uploaded",
  "parsed",
  "needs_review",
  "validated",
  "partially_posted",
] as const;

/**
 * The shape version of the stored `period_close.snapshot` jsonb. **Version 2**
 * (row 13b-1, `DEC-107`) adds the frozen `prerequisites` block; a version-1
 * snapshot (no `prerequisites`) stays accepted on read — the store carries the
 * jsonb through as `unknown`, so the version bump needs no migration.
 */
export const PERIOD_CLOSE_SNAPSHOT_VERSION = 2;

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

/** A status histogram with its `total` and the count of blocking statuses. */
export interface StatusCounts {
  readonly total: number;
  /** One entry per status in the source vocabulary, zero-filled (reproducible jsonb). */
  readonly byStatus: Readonly<Record<string, number>>;
  /** The subset of `total` whose status blocks a close. */
  readonly blocking: number;
}

/**
 * The `DEC-107` prerequisite block frozen into the version-2 close snapshot.
 * `reconciliations` and `importRuns` block a close; `exceptions` and
 * `tolerances` are informational (see each field).
 */
export interface ClosePrerequisites {
  /** Organization reconciliations whose period overlaps the close period. */
  readonly reconciliations: StatusCounts;
  /** Organization import runs whose period overlaps the close period. */
  readonly importRuns: StatusCounts;
  /**
   * Organization-scoped `data_quality_exception` rows in an open state
   * (`open`/`acknowledged`). Informational only — the table has no period or
   * location column, so it never blocks (`DEC-107`, recorded limitation).
   */
  readonly exceptions: { readonly open: number };
  /**
   * Whether an effective `reconciliation_tolerance` exists at the period end,
   * per kind. Informational only — the tolerance gate is already enforced at
   * reconciliation time (`DEC-107`).
   */
  readonly tolerances: Readonly<Record<ToleranceKind, boolean>>;
  /**
   * True for a `location` scope: `reconciliation`/`import_run` carry no location
   * dimension, so the evaluation is organization-wide by period only
   * (`DEC-107`, recorded limitation).
   */
  readonly scopeLimited: boolean;
}

export interface BuildClosePrerequisitesInput {
  /** Statuses of the reconciliations overlapping the close period. */
  readonly reconciliationStatuses: readonly string[];
  /** Statuses of the import runs overlapping the close period. */
  readonly importRunStatuses: readonly string[];
  /** Count of the organization's open (`open`/`acknowledged`) exceptions. */
  readonly openExceptions: number;
  /** Effective tolerance presence at the period end, keyed by kind. */
  readonly tolerances: Readonly<Record<ToleranceKind, boolean>>;
  /** True when the close scope is a location (see `ClosePrerequisites`). */
  readonly scopeLimited: boolean;
}

/**
 * Counts `statuses` into a zero-filled histogram over `vocabulary` and counts
 * how many fall in `blocking`. A status outside the vocabulary is a
 * `DomainError`: a close must not silently ignore a status it does not know.
 */
function countStatuses(
  statuses: readonly string[],
  vocabulary: readonly string[],
  blocking: readonly string[],
): StatusCounts {
  const byStatus: Record<string, number> = {};
  for (const status of vocabulary) {
    byStatus[status] = 0;
  }
  let blockingCount = 0;
  for (const status of statuses) {
    if (!(status in byStatus)) {
      throw new DomainError(`unknown prerequisite status ${JSON.stringify(status)}`);
    }
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (blocking.includes(status)) {
      blockingCount += 1;
    }
  }
  return { total: statuses.length, byStatus, blocking: blockingCount };
}

/**
 * Builds the `DEC-107` prerequisite block from the raw prerequisite reads: a
 * zero-filled status histogram per source plus its blocking count, the
 * organization-wide open-exception count, the effective-tolerance presence and
 * the `scopeLimited` flag. Everything is a string, a number or a boolean — no
 * floats — so the stored jsonb stays reproducible.
 */
export function buildClosePrerequisites(input: BuildClosePrerequisitesInput): ClosePrerequisites {
  return {
    reconciliations: countStatuses(
      input.reconciliationStatuses,
      CLOSE_RECONCILIATION_STATUSES,
      RECONCILIATION_BLOCKING_STATUSES,
    ),
    importRuns: countStatuses(
      input.importRunStatuses,
      CLOSE_IMPORT_STATUSES,
      IMPORT_RUN_BLOCKING_STATUSES,
    ),
    exceptions: { open: input.openExceptions },
    tolerances: {
      sales_settlement: input.tolerances.sales_settlement,
      supplier_invoice: input.tolerances.supplier_invoice,
    },
    scopeLimited: input.scopeLimited,
  };
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
  /** The `DEC-107` prerequisites evaluated when the close began (version 2). */
  readonly prerequisites: ClosePrerequisites;
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
  readonly prerequisites: ClosePrerequisites;
}

/**
 * Builds the frozen close snapshot (version 2, `DEC-107`): the schema version,
 * the scope and period, the capture instant, the checklist and the evaluated
 * prerequisites. Everything is a string, a number, a boolean or an array — no
 * floats — so the stored jsonb is reproducible.
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
    prerequisites: input.prerequisites,
  };
}
