import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Sales theoretical consumption and reconciliation tolerance (slice 12):
 * `SALE-003`/`SALE-005`, `REC-001`/`REC-005`; `DEC-009`, `DEC-026`, ADR-0005.
 *
 * `DEC-009` (accepted 2026-09-14): theoretical sale consumption posts stock
 * movements **daily per location**, with production/sales double-use prevention.
 * The application command (`postTheoreticalConsumption`) explodes a sold
 * variant to its component consumption through `explodeTheoreticalConsumption`;
 * the `source_id` grain (a whole day/location batch versus a single
 * `sales_line`) is a **recorded open point (A1)**, not resolved here — this
 * helper is grain-agnostic.
 *
 * The explosion follows `CALCULATION_CONTRACT.md` §6: a component's
 * `effective_line_qty = quantity / loss_factor`, grossed up by the usable yield
 * (`required_purchase_quantity = effective_line_qty / usable_yield_rate` at
 * 6 dp HALF_UP, boundary B0). Per one sold output unit that is
 * `component_qty / loss_factor / usable_yield_rate`; this helper scales it by
 * the sold quantity at the same single B0 rounding.
 *
 * `DEC-026` (accepted 2026-09-14): reconciliation tolerance is the greater of
 * `0.5%` or `5 NOK` for sales source and settlement, and of `1%` or `10 NOK` for
 * a supplier invoice. The decision's effective-dated FIN-owned configuration
 * has **no table** (recorded open point (b)): `withinTolerance` applies the
 * published default unless the caller supplies an explicit `tolerance`.
 *
 * Decimal only (never floats); HALF_UP once per named boundary (`DEC-024`).
 */

/** Component quantity at the stock-ledger quantity scale (`numeric(19,6)`). */
const RATE_SCALE = 6;
const RATE_ONE = 10n ** BigInt(RATE_SCALE);

export interface RecipeComponentQuantityInput {
  /** The stocked component item the consumption is posted against. */
  readonly itemId: string;
  /**
   * Base-unit quantity of the component per **one** output unit of the recipe
   * (`numeric(19,6)`), before the yield gross-up. The caller converts the
   * recipe line from its own unit into the component item's base unit.
   */
  readonly quantityPerOutput: string;
  /**
   * Trim/cooking loss factor in `(0,1]` (`recipe_line.loss_factor`); defaults to
   * `1` (no loss). `CALCULATION_CONTRACT §6`: `quantity / loss_factor`.
   */
  readonly lossFactor?: string;
}

export interface TheoreticalConsumptionInput {
  /** Sold quantity of the variant in its output item's base unit; `>= 0`. */
  readonly soldQuantity: string;
  /** `numeric(9,6)` usable yield rate in `(0,1]` (`recipe_version.yield_rate`). */
  readonly usableYieldRate: string;
  readonly components: readonly RecipeComponentQuantityInput[];
}

export interface TheoreticalConsumptionLine {
  readonly itemId: string;
  /** `numeric(19,6)` base units of the component consumed, HALF_UP. */
  readonly quantity: string;
}

/**
 * Explodes a sold variant quantity to its component consumption:
 *
 * ```
 * consumption(component) = round(soldQuantity × component_qty / loss_factor
 *                                 / usable_yield_rate, 6 dp)   # B0, HALF_UP
 * ```
 *
 * The result is aggregated per component item (a recipe may repeat an item
 * across lines) and sorted by `itemId` so the output is deterministic. Zero
 * lines are kept: the caller decides whether to post them (the ledger rejects a
 * zero movement). Pure and IO-free.
 */
export function explodeTheoreticalConsumption(
  input: TheoreticalConsumptionInput,
): readonly TheoreticalConsumptionLine[] {
  const sold = parseDecimal(input.soldQuantity, QUANTITY_SCALE);
  if (sold < 0n) {
    throw new DomainError("soldQuantity must not be negative");
  }
  const yieldRate = parseDecimal(input.usableYieldRate, RATE_SCALE);
  if (yieldRate <= 0n || yieldRate > RATE_ONE) {
    throw new DomainError("usableYieldRate must be in (0,1]");
  }

  const totals = new Map<string, bigint>();
  for (const component of input.components) {
    const quantityPerOutput = parseDecimal(component.quantityPerOutput, QUANTITY_SCALE);
    if (quantityPerOutput < 0n) {
      throw new DomainError("component quantityPerOutput must not be negative");
    }
    const loss = parseDecimal(component.lossFactor ?? "1", RATE_SCALE);
    if (loss <= 0n || loss > RATE_ONE) {
      throw new DomainError("component lossFactor must be in (0,1]");
    }
    // sold (6 dp) × qty (6 dp) → 12 dp; scale back to 6 dp in one HALF_UP step
    // after dividing by loss × yield (both 6 dp).
    const consumed = divideRoundHalfUp(sold * quantityPerOutput * RATE_ONE, loss * yieldRate);
    totals.set(component.itemId, (totals.get(component.itemId) ?? 0n) + consumed);
  }

  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([itemId, quantity]) => ({ itemId, quantity: formatDecimal(quantity, QUANTITY_SCALE) }));
}

/** Reconciliation tolerance kinds named by `DEC-026`. */
export const TOLERANCE_KINDS = ["sales_settlement", "supplier_invoice"] as const;
export type ToleranceKind = (typeof TOLERANCE_KINDS)[number];

/**
 * The published `DEC-026` defaults. `rate` is the fraction (0.5% / 1%) at 6 dp;
 * `floor` is the NOK minimum at money scale. The effective-dated FIN-owned
 * configuration has no table (recorded open point (b)), so this is the only
 * source of a default.
 */
export const RECONCILIATION_TOLERANCE_DEFAULTS: Readonly<
  Record<ToleranceKind, { readonly rate: string; readonly floor: string }>
> = {
  sales_settlement: { rate: "0.005", floor: "5" },
  supplier_invoice: { rate: "0.01", floor: "10" },
};

/**
 * `DEC-026`: the tolerance for `kind` against `expectedAmount` is the greater of
 * the percentage of the expected amount or the flat floor, at money scale
 * (`max(0.5%, 5 NOK)` for sales/settlement; `max(1%, 10 NOK)` for a supplier
 * invoice). The percentage is computed on the **absolute** expected amount, so
 * a credit/refund is tolerated by the same rule.
 */
export function defaultToleranceFor(kind: ToleranceKind, expectedAmount: string): string {
  const config = RECONCILIATION_TOLERANCE_DEFAULTS[kind];
  if (config === undefined) {
    throw new DomainError(`unknown tolerance kind "${kind}"`);
  }
  const expected = parseDecimal(expectedAmount, MONEY_SCALE);
  const absolute = expected < 0n ? -expected : expected;
  const percentage = divideRoundHalfUp(absolute * parseDecimal(config.rate, RATE_SCALE), RATE_ONE);
  const floor = parseDecimal(config.floor, MONEY_SCALE);
  return formatDecimal(percentage > floor ? percentage : floor, MONEY_SCALE);
}

export interface EvaluateToleranceInput {
  readonly expected: string;
  readonly actual: string;
  readonly kind: ToleranceKind;
  /**
   * Explicit tolerance override (`numeric(19,4)`). When omitted the `DEC-026`
   * default for `kind` is applied; the application layer decides whether that
   * default is permitted (a missing FIN-owned tolerance may block close).
   */
  readonly tolerance?: string;
}

export interface ToleranceEvaluation {
  readonly kind: ToleranceKind;
  /** The tolerance actually applied (`numeric(19,4)`). */
  readonly tolerance: string;
  /** `actual − expected` (`numeric(19,4)`), signed. */
  readonly difference: string;
  /** `|actual − expected|` (`numeric(19,4)`). */
  readonly absoluteDifference: string;
  readonly withinTolerance: boolean;
}

/**
 * Evaluates `actual` against `expected` under the tolerance for `kind`
 * (`DEC-026`/`DEC-035`): the residual after dispositions is within tolerance
 * when `|actual − expected| <= tolerance`. Returns the tolerance used and the
 * signed difference so a caller can persist both on the reconciliation row.
 */
export function withinTolerance(input: EvaluateToleranceInput): ToleranceEvaluation {
  const expected = parseDecimal(input.expected, MONEY_SCALE);
  const actual = parseDecimal(input.actual, MONEY_SCALE);
  const tolerance =
    input.tolerance === undefined
      ? parseDecimal(defaultToleranceFor(input.kind, input.expected), MONEY_SCALE)
      : parseDecimal(input.tolerance, MONEY_SCALE);
  if (tolerance < 0n) {
    throw new DomainError("tolerance must not be negative");
  }
  const difference = actual - expected;
  const absoluteDifference = difference < 0n ? -difference : difference;
  return {
    kind: input.kind,
    tolerance: formatDecimal(tolerance, MONEY_SCALE),
    difference: formatDecimal(difference, MONEY_SCALE),
    absoluteDifference: formatDecimal(absoluteDifference, MONEY_SCALE),
    withinTolerance: absoluteDifference <= tolerance,
  };
}
