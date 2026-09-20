import { divideRoundHalfUp, formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/** Stock values share money's numeric(19,4) scale (DATA_DICTIONARY §6). */
export const STOCK_VALUE_SCALE = MONEY_SCALE;

/** Stock quantities share the numeric(19,6) scale (DATA_DICTIONARY §6). */
export const STOCK_QUANTITY_SCALE = QUANTITY_SCALE;

/**
 * A point-in-time `stock_balance` projection (DATA_DICTIONARY §6): rebuilt from
 * the ledger, never edited directly (`02:70`). `avgUnitCost` is null precisely
 * when `quantityOnHand` is zero (`09:33` invariant: balance ≡ Σ movements).
 */
export interface StockBalanceSnapshot {
  /** numeric(19,6), signed. */
  readonly quantityOnHand: string;
  /** numeric(19,4), signed. */
  readonly valueOnHand: string;
  /** numeric(19,4), null when `quantityOnHand` is zero. */
  readonly avgUnitCost: string | null;
}

/** The signed quantity/value a single `stock_movement` contributes (INV-001). */
export interface StockMovementValue {
  /** numeric(19,6), signed; negative = out. */
  readonly quantityDelta: string;
  /** numeric(19,4), signed. */
  readonly valueDelta: string;
}

/** One movement to post against a balance. */
export interface PostMovementInput {
  /** numeric(19,6), signed, must not be zero. */
  readonly quantityDelta: string;
  /** numeric(19,4); required for an inbound (positive) delta and must be >= 0. */
  readonly unitCost?: string | null;
}

export interface StockPostingResult extends StockBalanceSnapshot {
  /** numeric(19,4), signed. */
  readonly valueDelta: string;
  /** numeric(19,4): inbound unit cost (or explicit 0), or the outbound moving average. */
  readonly unitCostApplied: string;
}

/**
 * Moving weighted average valuation (ADR-0005, DEC-008, `04:138-141`):
 *
 * ```
 * new_average_cost = (old_quantity × old_average_cost + receipt_quantity × receipt_unit_cost)
 *                    / (old_quantity + receipt_quantity)
 * ```
 *
 * Outbound movements **retain the average at posting time** and never recompute
 * it (`04:141`). Reversals restore the original movement's quantity and value
 * (`04:142`, DEC-028); they are exact negations, not repostings at current cost.
 *
 * Decimal only; the single named boundary is the 4 dp average, rounded HALF_UP
 * per DEC-024/CALCULATION_CONTRACT §1. Floats are never used.
 */

/** True when `quantityOnHand + quantityDelta < 0` (DEC-010 guard input). */
export function wouldDriveNegative(quantityOnHand: string, quantityDelta: string): boolean {
  const onHand = parseDecimal(quantityOnHand, STOCK_QUANTITY_SCALE);
  const delta = parseDecimal(quantityDelta, STOCK_QUANTITY_SCALE);
  return onHand + delta < 0n;
}

/**
 * Signed value for one movement at the current balance's average.
 *
 * ```
 * inbound  (dq > 0): value_delta = round(unit_cost × dq, 4 dp, HALF_UP)   # B4
 * outbound (dq < 0): value_delta = round(raw_avg × dq, 4 dp, HALF_UP)     # B4
 * ```
 *
 * An outbound posts at the balance's `avgUnitCost` (`04:141`) — or zero when
 * there is no average yet, which is the DEC-010 override path. Decimal only;
 * HALF_UP rounds once at B4 (DEC-024).
 */
export function computeMovementValue(input: {
  readonly quantityDelta: string;
  readonly unitCost?: string | null;
  readonly avgUnitCost: string | null;
}): string {
  const quantityDelta = parseDecimal(input.quantityDelta, STOCK_QUANTITY_SCALE);
  if (quantityDelta === 0n) {
    throw new DomainError("stock movement quantity delta must not be zero");
  }

  if (quantityDelta > 0n) {
    if (input.unitCost === undefined || input.unitCost === null) {
      throw new DomainError("inbound stock movement requires a unit cost");
    }
    const unitCost = parseDecimal(input.unitCost, STOCK_VALUE_SCALE);
    if (unitCost < 0n) {
      throw new DomainError("inbound stock movement unit cost must not be negative");
    }
    const raw = unitCost * quantityDelta;
    return formatDecimal(
      rescale(raw, STOCK_VALUE_SCALE + STOCK_QUANTITY_SCALE, STOCK_VALUE_SCALE),
      STOCK_VALUE_SCALE,
    );
  }

  const avgUnitCost = parseDecimal(input.avgUnitCost ?? "0.0000", STOCK_VALUE_SCALE);
  const raw = avgUnitCost * quantityDelta;
  return formatDecimal(
    rescale(raw, STOCK_VALUE_SCALE + STOCK_QUANTITY_SCALE, STOCK_VALUE_SCALE),
    STOCK_VALUE_SCALE,
  );
}

/**
 * Derive the moving weighted average unit cost from a balance (`04:138-141`):
 * `avg = value_on_hand / quantity_on_hand`, carried at `STOCK_VALUE_SCALE` and
 * rounded HALF_UP once (DEC-024/CALCULATION_CONTRACT §1). `null` precisely when
 * `quantityOnHand` is zero (`09:33`). Decimal only; floats are never used.
 *
 * This is the **single source of truth** for the 4 dp average: live postings
 * (`applyStockMovementValue`) and as-of rebuilds (`recomputeStockBalance`) both
 * call it, so they cannot drift (ADR-0005, DEC-008, DEC-024).
 */
export function deriveAverageUnitCost(quantityOnHand: string, valueOnHand: string): string | null {
  const quantity = parseDecimal(quantityOnHand, STOCK_QUANTITY_SCALE);
  if (quantity === 0n) {
    return null;
  }
  const value = parseDecimal(valueOnHand, STOCK_VALUE_SCALE);
  return formatDecimal(
    divideRoundHalfUp(value * 10n ** BigInt(STOCK_QUANTITY_SCALE), quantity),
    STOCK_VALUE_SCALE,
  );
}

/**
 * Apply an explicit quantity/value delta (no recomputation at current cost).
 *
 * The single source of truth for the balance arithmetic and the average rule:
 * `applyStockMovement` values a movement first and then delegates here, and the
 * reversal/ revaluation path applies an exactly-negated value the same way.
 * Does **not** reject a negative result: the application layer owns the DEC-010
 * override guard and calls `wouldDriveNegative` before posting.
 *
 * The average is carried at 4 dp. With `new_value` at 4 dp and `new_qty` at
 * 6 dp: `avg = new_value / 10^4 ÷ (new_qty / 10^6)`, so
 * `avg × 10^4 = new_value × 10^6 / new_qty`, rounded HALF_UP once (DEC-024);
 * `null` when the new quantity is zero (`09:33`). Derived via
 * `deriveAverageUnitCost`.
 */
export function applyStockMovementValue(
  balance: StockBalanceSnapshot,
  movement: StockMovementValue,
): StockBalanceSnapshot {
  const quantityOnHand =
    parseDecimal(balance.quantityOnHand, STOCK_QUANTITY_SCALE) +
    parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE);
  const valueOnHand =
    parseDecimal(balance.valueOnHand, STOCK_VALUE_SCALE) +
    parseDecimal(movement.valueDelta, STOCK_VALUE_SCALE);

  const avgUnitCost = deriveAverageUnitCost(
    formatDecimal(quantityOnHand, STOCK_QUANTITY_SCALE),
    formatDecimal(valueOnHand, STOCK_VALUE_SCALE),
  );

  return {
    quantityOnHand: formatDecimal(quantityOnHand, STOCK_QUANTITY_SCALE),
    valueOnHand: formatDecimal(valueOnHand, STOCK_VALUE_SCALE),
    avgUnitCost,
  };
}

/**
 * Apply one movement to a balance and return the new balance plus the value
 * posted (ADR-0005, INV-001). Values the movement with `computeMovementValue`
 * and delegates the balance arithmetic to `applyStockMovementValue`, so the
 * average is derived in exactly one place. Does **not** reject a negative
 * result: the application layer owns the DEC-010 override guard and calls
 * `wouldDriveNegative` before posting.
 */
export function applyStockMovement(
  balance: StockBalanceSnapshot,
  movement: PostMovementInput,
): StockPostingResult {
  const valueDelta = computeMovementValue({
    quantityDelta: movement.quantityDelta,
    avgUnitCost: balance.avgUnitCost,
    ...(movement.unitCost === undefined ? {} : { unitCost: movement.unitCost }),
  });

  const applied = applyStockMovementValue(balance, {
    quantityDelta: movement.quantityDelta,
    valueDelta,
  });

  const inbound = parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE) > 0n;
  const unitCostApplied = inbound
    ? formatDecimal(parseDecimal(movement.unitCost ?? "0", STOCK_VALUE_SCALE), STOCK_VALUE_SCALE)
    : formatDecimal(
        parseDecimal(balance.avgUnitCost ?? "0.0000", STOCK_VALUE_SCALE),
        STOCK_VALUE_SCALE,
      );

  return { ...applied, valueDelta, unitCostApplied };
}

/** Negate quantity and value exactly; a reversal never recomputes at current cost (`04:142`, DEC-028). */
export function reverseStockMovement(movement: StockMovementValue): StockMovementValue {
  return {
    quantityDelta: formatDecimal(
      -parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE),
      STOCK_QUANTITY_SCALE,
    ),
    valueDelta: formatDecimal(
      -parseDecimal(movement.valueDelta, STOCK_VALUE_SCALE),
      STOCK_VALUE_SCALE,
    ),
  };
}

/**
 * Rebuild a balance from its movements: the authoritative as-of/rebuild rule
 * (`09:33`, DATA_DICTIONARY §6 invariant `quantity_on_hand = Σ quantity_delta`).
 * Empty history yields a zero balance with a null average.
 */
export function recomputeStockBalance(
  movements: readonly StockMovementValue[],
): StockBalanceSnapshot {
  let quantityOnHand = 0n;
  let valueOnHand = 0n;
  for (const movement of movements) {
    quantityOnHand += parseDecimal(movement.quantityDelta, STOCK_QUANTITY_SCALE);
    valueOnHand += parseDecimal(movement.valueDelta, STOCK_VALUE_SCALE);
  }

  const avgUnitCost = deriveAverageUnitCost(
    formatDecimal(quantityOnHand, STOCK_QUANTITY_SCALE),
    formatDecimal(valueOnHand, STOCK_VALUE_SCALE),
  );

  return {
    quantityOnHand: formatDecimal(quantityOnHand, STOCK_QUANTITY_SCALE),
    valueOnHand: formatDecimal(valueOnHand, STOCK_VALUE_SCALE),
    avgUnitCost,
  };
}

/**
 * The value-only delta needed to clear a residual when quantity is zero, or
 * null when there is nothing to clear (DEC-028 revaluation correction).
 */
export function revaluationGap(balance: StockBalanceSnapshot): string | null {
  const quantityOnHand = parseDecimal(balance.quantityOnHand, STOCK_QUANTITY_SCALE);
  const valueOnHand = parseDecimal(balance.valueOnHand, STOCK_VALUE_SCALE);
  if (quantityOnHand === 0n && valueOnHand !== 0n) {
    return formatDecimal(-valueOnHand, STOCK_VALUE_SCALE);
  }
  return null;
}
