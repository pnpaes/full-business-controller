import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Full cost and overhead allocation (COST-007/011, CALCULATION_CONTRACT §9,
 * 04_CALCULATIONS §4.6):
 *
 * ```
 * entity_driver_share     = entity_driver_volume / total_driver_volume
 * allocated_pool_amount   = period_cost_pool × entity_driver_share       # money 4 dp
 * allocated_unit_overhead = allocated_pool_amount / eligible_driver_volume  # money 4 dp
 * unit_full_cost          = unit_variable_cost + allocated_unit_overhead
 * full_cost_margin        = unit_net_sales − unit_full_cost
 * ```
 *
 * Decimal only (never floats); HALF_UP once per named boundary. A missing or
 * zero denominator **stops** allocation; the only alternative is an explicitly
 * configured `equal_share` fallback across an explicit eligible-entity count.
 * The code never divides silently (`04:97`, §12.6).
 */

export const ALLOCATION_FALLBACKS = ["stop", "equal_share"] as const;
export type AllocationFallback = (typeof ALLOCATION_FALLBACKS)[number];

/** Rate/ratio scale (`numeric(9,6)`, DEC-024). */
const RATE_SCALE = 6;
const RATE_ONE = 10n ** BigInt(RATE_SCALE);

/**
 * `entity_driver_share = entity_driver_volume / total_driver_volume`, at 6 dp
 * HALF_UP. Rejects a negative entity volume and a non-positive total, because a
 * share against no driver volume is undefined (never divide silently).
 */
export function entityDriverShare(entityDriverVolume: string, totalDriverVolume: string): string {
  const entity = parseDecimal(entityDriverVolume, QUANTITY_SCALE);
  const total = parseDecimal(totalDriverVolume, QUANTITY_SCALE);
  if (entity < 0n) {
    throw new DomainError("entityDriverVolume must not be negative");
  }
  if (total <= 0n) {
    throw new DomainError("totalDriverVolume must be positive");
  }
  return formatDecimal(divideRoundHalfUp(entity * RATE_ONE, total), RATE_SCALE);
}

/**
 * `allocated_pool_amount = period_cost_pool × (entity_driver_volume / total_driver_volume)`,
 * rounded **once** at 4 dp (B-money). The share is not rounded before the
 * multiplication, so the boundary is crossed exactly once.
 */
export function allocatedPoolAmount(
  poolAmount: string,
  entityDriverVolume: string,
  totalDriverVolume: string,
): string {
  const pool = parseDecimal(poolAmount, MONEY_SCALE);
  const entity = parseDecimal(entityDriverVolume, QUANTITY_SCALE);
  const total = parseDecimal(totalDriverVolume, QUANTITY_SCALE);
  if (pool < 0n) {
    throw new DomainError("poolAmount must not be negative");
  }
  if (entity < 0n) {
    throw new DomainError("entityDriverVolume must not be negative");
  }
  if (total <= 0n) {
    throw new DomainError("totalDriverVolume must be positive");
  }
  return formatDecimal(divideRoundHalfUp(pool * entity, total), MONEY_SCALE);
}

export interface AllocatedUnitOverheadOptions {
  /** Default `"stop"`. */
  readonly fallback?: AllocationFallback;
  /** Required (and `> 0`) when `fallback` is `"equal_share"`. */
  readonly eligibleEntityCount?: string;
}

/**
 * `allocated_unit_overhead = allocated_pool_amount / eligible_driver_volume`,
 * at 4 dp HALF_UP. A missing/zero volume throws under the default `"stop"`
 * fallback; the explicit `"equal_share"` fallback instead spreads the amount
 * across `eligibleEntityCount` entities. Pass `"0"` for a missing volume — the
 * denominator is never invented.
 */
export function allocatedUnitOverhead(
  allocatedPoolAmount: string,
  eligibleDriverVolume: string,
  options?: AllocatedUnitOverheadOptions,
): string {
  const amount = parseDecimal(allocatedPoolAmount, MONEY_SCALE);
  if (amount < 0n) {
    throw new DomainError("allocatedPoolAmount must not be negative");
  }
  const volume = parseDecimal(eligibleDriverVolume, QUANTITY_SCALE);
  const fallback = options?.fallback ?? "stop";
  if (!(ALLOCATION_FALLBACKS as readonly string[]).includes(fallback)) {
    throw new DomainError(`unknown allocation fallback "${fallback}"`);
  }

  if (fallback === "equal_share") {
    const countValue = options?.eligibleEntityCount;
    if (countValue === undefined) {
      throw new DomainError("eligibleEntityCount is required when fallback is equal_share");
    }
    const count = parseDecimal(countValue, 0);
    if (count <= 0n) {
      throw new DomainError("eligibleEntityCount must be a positive integer");
    }
    if (volume <= 0n) {
      return formatDecimal(divideRoundHalfUp(amount, count), MONEY_SCALE);
    }
  }

  if (volume <= 0n) {
    throw new DomainError("allocation denominator is missing or zero");
  }
  // amount (4 dp) / volume (6 dp), scaled back to 4 dp in one HALF_UP step.
  return formatDecimal(divideRoundHalfUp(amount * RATE_ONE, volume), MONEY_SCALE);
}

/** `unit_full_cost = unit_variable_cost + allocated_unit_overhead`, at 4 dp. */
export function unitFullCost(unitVariableCost: string, allocatedUnitOverhead: string): string {
  const variableCost = parseDecimal(unitVariableCost, MONEY_SCALE);
  const overhead = parseDecimal(allocatedUnitOverhead, MONEY_SCALE);
  if (variableCost < 0n) {
    throw new DomainError("unitVariableCost must not be negative");
  }
  if (overhead < 0n) {
    throw new DomainError("allocatedUnitOverhead must not be negative");
  }
  return formatDecimal(variableCost + overhead, MONEY_SCALE);
}

/**
 * `full_cost_margin = unit_net_sales − unit_full_cost`, at 4 dp. The margin may
 * be negative; `unitNetSales` may be any value.
 */
export function fullCostMargin(unitNetSales: string, unitFullCost: string): string {
  const netSales = parseDecimal(unitNetSales, MONEY_SCALE);
  const fullCost = parseDecimal(unitFullCost, MONEY_SCALE);
  if (fullCost < 0n) {
    throw new DomainError("unitFullCost must not be negative");
  }
  return formatDecimal(netSales - fullCost, MONEY_SCALE);
}
