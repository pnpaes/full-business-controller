import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Production batch yield and output cost (slice 10; `PROD-002`/`PROD-003`,
 * `CALCULATION_CONTRACT.md` §6 B3, `ADR-0005`).
 *
 * ```
 * usable_yield_rate            = approved_usable_output / planned_input        # ∈ (0,1]
 * cost_per_usable_output_unit  = round(recipe_output_cost / approved_usable_output, 4 dp)  # B3
 * ```
 *
 * Decimal only (never floats); HALF_UP once at each named boundary (DEC-024).
 * Yield/output-cost rates are pure arithmetic: the ledger relationships live in
 * `stock.ts`, and the application layer supplies already-converted, already-
 * valued inputs.
 *
 * The `yield_rate` here is the **actual** output/input ratio, deliberately not
 * bounded to `(0,1]` like `usableYieldRate` (`recipe.ts`): a batch may over-yield
 * (added water, a generous portion), and the actual ratio is a fact to store, not
 * a contract input — the plan-time rate is the one §6 bounds.
 */

/** `numeric(9,6)` (`schemas/domain-enums.yaml`: percentages/rates are never rounded to money). */
const RATE_SCALE = 6;

/**
 * Scales a quantity by the exact ratio `numerator / denominator`, rounding
 * **once** at B0 (6 dp, HALF_UP):
 *
 * ```
 * scaled = round(quantity × numerator / denominator, 6 dp)   # B0
 * ```
 *
 * `DEC-125`: the ratio is `planned_qty / recipe_version.planned_output_qty`,
 * used to scale a recipe version's single-batch planned snapshot to a batch's
 * intended output quantity. The multiply and divide are combined into one
 * HALF_UP step, so B0 is crossed exactly once — never at intermediate algebra.
 * `denominator` must be positive (a zero planned output makes the ratio
 * undefined); `quantity` and `numerator` must not be negative.
 */
export function scaleQuantityByRatio(
  quantity: string,
  numerator: string,
  denominator: string,
): string {
  const qty = parseDecimal(quantity, QUANTITY_SCALE);
  const num = parseDecimal(numerator, QUANTITY_SCALE);
  const den = parseDecimal(denominator, QUANTITY_SCALE);
  if (qty < 0n) {
    throw new DomainError("quantity must not be negative");
  }
  if (num < 0n) {
    throw new DomainError("numerator must not be negative");
  }
  if (den <= 0n) {
    throw new DomainError("denominator must be positive");
  }
  return formatDecimal(divideRoundHalfUp(qty * num, den), QUANTITY_SCALE);
}

/**
 * `yield_rate = output_qty / input_qty`, at 6 dp HALF_UP (CALCULATION_CONTRACT
 * §6; `production_batch.yield_variance_pct` is `numeric(9,6)`). `inputQty` must
 * be positive (a zero planned input makes the ratio undefined) and `outputQty`
 * must not be negative. A ratio above 1 is allowed: an actual over-yield is a
 * legitimate batch fact, unlike the plan-time `usableYieldRate` which §6 bounds.
 */
export function yieldRate(outputQty: string, inputQty: string): string {
  const input = parseDecimal(inputQty, QUANTITY_SCALE);
  const output = parseDecimal(outputQty, QUANTITY_SCALE);
  if (input <= 0n) {
    throw new DomainError("inputQty must be positive to derive a yield rate");
  }
  if (output < 0n) {
    throw new DomainError("outputQty must not be negative");
  }
  return formatDecimal(divideRoundHalfUp(output * 10n ** BigInt(RATE_SCALE), input), RATE_SCALE);
}

/**
 * `yield_variance_pct = (actual_output − planned_output) / planned_output`, at
 * 6 dp HALF_UP. Stored as a **fraction**, not multiplied by 100: the contract
 * says percentages are stored `numeric(9,6)` and never rounded to a money
 * boundary (§1). Negative when the batch under-yields, matching the sign
 * convention of the slice-10 schema test (`−0.050000`). `plannedOutput` must be
 * positive and `actualOutput` must not be negative.
 */
export function yieldVariancePct(plannedOutput: string, actualOutput: string): string {
  const planned = parseDecimal(plannedOutput, QUANTITY_SCALE);
  const actual = parseDecimal(actualOutput, QUANTITY_SCALE);
  if (planned <= 0n) {
    throw new DomainError("plannedOutput must be positive to derive a yield variance");
  }
  if (actual < 0n) {
    throw new DomainError("actualOutput must not be negative");
  }
  return formatDecimal(
    divideRoundHalfUp((actual - planned) * 10n ** BigInt(RATE_SCALE), planned),
    RATE_SCALE,
  );
}

/**
 * `cost_per_usable_output_unit = round(recipe_output_cost / approved_usable_output, 4 dp)`
 * (CALCULATION_CONTRACT §6 B3, `ADR-0005`) — the unit cost the completion command
 * posts on the positive `production_output` movement, computed from the **actual**
 * input value booked by the consumption movements and the actual usable output.
 *
 * B3 is crossed exactly once, HALF_UP (DEC-024). `usableOutputQty` must be
 * positive (§12.2 rejects a non-positive approved usable output); `inputCost` is
 * `numeric(19,4)` and must not be negative. Decimal only; floats are never used.
 */
export function outputUnitCost(inputCost: string, usableOutputQty: string): string {
  const cost = parseDecimal(inputCost, MONEY_SCALE);
  const output = parseDecimal(usableOutputQty, QUANTITY_SCALE);
  if (output <= 0n) {
    throw new DomainError("usableOutputQty must be positive (CALCULATION_CONTRACT §12.2)");
  }
  if (cost < 0n) {
    throw new DomainError("inputCost must not be negative");
  }
  // value (4 dp) / quantity (6 dp), carried back to 4 dp in one HALF_UP step:
  // scaled = cost × 10^6 / output, matching `deriveAverageUnitCost` in `stock.ts`.
  return formatDecimal(
    divideRoundHalfUp(cost * 10n ** BigInt(QUANTITY_SCALE), output),
    MONEY_SCALE,
  );
}
