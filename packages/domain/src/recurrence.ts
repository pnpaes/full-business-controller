import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";

/**
 * `DEC-115` recurrence→period normalisation for the allocated-overhead pool.
 *
 * An `operating_cost.amount` is a **per-recurrence-unit** amount (e.g. an
 * `annual` cost amount covers a year), so summing linked costs verbatim
 * inflates a one-month pool. Each cost is scaled to the half-open allocation
 * period `[periodFrom, periodTo)` by the exact rational factor
 * `periodDays / nominalDays`, anchored on the calendar at `periodFrom`:
 *
 * | recurrence  | nominalDays                                            |
 * | ----------- | ------------------------------------------------------ |
 * | `daily`     | 1                                                      |
 * | `weekly`    | 7                                                      |
 * | `monthly`   | days in the calendar month containing `periodFrom`     |
 * | `quarterly` | days in the 3 calendar months from `periodFrom`'s      |
 * | `annual`    | days in the 12 calendar months from `periodFrom`'s     |
 * | `one_off`   | face value once, only when the period contains its     |
 * |             | `effectiveFrom`; 0 in every other period               |
 *
 * `periodDays` is the whole-day count of the half-open UTC window.
 *
 * The contributions are summed **exactly** as BigInt rationals over a common
 * denominator (the LCM of the nominal day counts) and rounded **once** at
 * `MONEY_SCALE` HALF_UP — never at an intermediate step
 * (`docs/phase0/CALCULATION_CONTRACT.md` B0–B4). An unknown recurrence is a
 * message-only `DomainError`; the write path restricts the vocabulary to
 * `OPERATING_COST_RECURRENCE`.
 */

export interface RecurringCostToNormalise {
  /** `numeric(19,4)` money string. */
  readonly amount: string;
  /** An `OPERATING_COST_RECURRENCE` value. */
  readonly recurrence: string;
  /** `yyyy-mm-dd`; the `one_off` period-membership key. */
  readonly effectiveFrom: string;
}

const DAY_MS = 86_400_000;

interface CalendarDate {
  readonly year: number;
  /** 0-based, like `Date.UTC`. */
  readonly month: number;
  readonly day: number;
}

/** An exact contribution: `numerator` MONEY_SCALE units spread over `denominator` days. */
interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function parseIsoDate(value: string, field: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw new DomainError(`${field} must be a yyyy-mm-dd date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month, day));
  if (
    year < 1 ||
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month ||
    instant.getUTCDate() !== day
  ) {
    throw new DomainError(`${field} is not a valid calendar date`);
  }
  return { year, month, day };
}

/** Whole days in the half-open UTC window `[from, to)`. */
function wholeDaysBetween(from: string, to: string): number {
  const start = parseIsoDate(from, "periodFrom");
  const end = parseIsoDate(to, "periodTo");
  const days =
    (Date.UTC(end.year, end.month, end.day) - Date.UTC(start.year, start.month, start.day)) /
    DAY_MS;
  if (days < 0) {
    throw new DomainError("periodTo must not precede periodFrom");
  }
  return days;
}

/** Days in `count` consecutive calendar months starting at `(year, month)`. */
function daysInMonths(year: number, month: number, count: number): number {
  return (Date.UTC(year, month + count, 1) - Date.UTC(year, month, 1)) / DAY_MS;
}

function nominalDays(recurrence: string, from: CalendarDate): number {
  switch (recurrence) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "monthly":
      return daysInMonths(from.year, from.month, 1);
    case "quarterly":
      return daysInMonths(from.year, from.month, 3);
    case "annual":
      return daysInMonths(from.year, from.month, 12);
    default:
      throw new DomainError(`unknown operating cost recurrence "${recurrence}"`);
  }
}

/**
 * The exact period-scaled contribution of one cost, or `undefined` when it
 * contributes nothing (a `one_off` outside its period, a zero amount, or a
 * zero-length period). Amounts are kept at `MONEY_SCALE`; the denominator is
 * the nominal day count, so the caller can sum over a common denominator.
 */
function contribution(
  cost: RecurringCostToNormalise,
  periodFrom: string,
  periodTo: string,
): Rational | undefined {
  const amount = parseDecimal(cost.amount, MONEY_SCALE);
  if (amount === 0n) {
    return undefined;
  }
  const recurrence = cost.recurrence.trim();
  if (recurrence === "one_off") {
    // Face value once, only in the period that contains its effectiveFrom.
    if (cost.effectiveFrom < periodFrom || cost.effectiveFrom >= periodTo) {
      return undefined;
    }
    return { numerator: amount, denominator: 1n };
  }
  const days = wholeDaysBetween(periodFrom, periodTo);
  if (days === 0) {
    return undefined;
  }
  const nominal = nominalDays(recurrence, parseIsoDate(periodFrom, "periodFrom"));
  return { numerator: amount * BigInt(days), denominator: BigInt(nominal) };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * The linked costs scaled to the allocation period and summed exactly, rounded
 * once at `MONEY_SCALE` HALF_UP. An empty (or all-zero) set is `"0.0000"`.
 * Throws a message-only `DomainError` on an unknown recurrence.
 */
export function normaliseRecurringCostsToPeriod(input: {
  readonly costs: readonly RecurringCostToNormalise[];
  readonly periodFrom: string;
  readonly periodTo: string;
}): string {
  const parts: Rational[] = [];
  for (const cost of input.costs) {
    const part = contribution(cost, input.periodFrom, input.periodTo);
    if (part !== undefined) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return formatDecimal(0n, MONEY_SCALE);
  }
  // Common denominator = LCM of the nominal day counts; contributions are
  // exact rationals of MONEY_SCALE units, so a single HALF_UP at the end
  // crosses the B-money boundary once.
  let common = 1n;
  for (const part of parts) {
    common = (common / gcd(common, part.denominator)) * part.denominator;
  }
  let numerator = 0n;
  for (const part of parts) {
    numerator += part.numerator * (common / part.denominator);
  }
  return formatDecimal(divideRoundHalfUp(numerator, common), MONEY_SCALE);
}

/**
 * Whether a linked cost contributes a **non-zero** scaled amount to the
 * period pool — the `operatingCostIds` filter (`DEC-115`). A `one_off` outside
 * its period, or any zero amount, is `false`.
 */
export function recurringCostContributesToPeriod(
  cost: RecurringCostToNormalise,
  periodFrom: string,
  periodTo: string,
): boolean {
  return contribution(cost, periodFrom, periodTo) !== undefined;
}
