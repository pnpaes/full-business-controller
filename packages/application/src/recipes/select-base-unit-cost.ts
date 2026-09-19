import {
  divideRoundHalfUp,
  DomainError,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  QUANTITY_SCALE,
} from "@aquarela/domain";

/**
 * Cost selection (DEC-021 / DEC-047, `CALCULATION_CONTRACT` §3): the first
 * source that yields a cost wins, in strict precedence
 *
 * 1. latest effective supplier price (`supplier_price`, treated as approved),
 * 2. latest cost observation (`cost_observation`) observed on or before `asOf`,
 * 3. the item's manually maintained `current_cost`.
 *
 * The tier precedence is documented; a tie **inside** a tier is not. Two
 * candidates sharing the latest date with different values are therefore
 * rejected as ambiguous rather than resolved by guessing (mirrors the
 * conversion-graph ambiguity handling).
 */

export type CostSourceType = "supplier_price" | "cost_observation" | "current_cost";

export interface SupplierPriceCost {
  readonly cost: string;
  readonly effectiveFrom: Date;
}

export interface CostObservationCost {
  readonly cost: string;
  readonly observedAt: string;
}

export interface SelectBaseUnitCostInput {
  readonly supplierPrices: readonly SupplierPriceCost[];
  readonly observations: readonly CostObservationCost[];
  readonly currentCost: string | null;
}

export interface BaseUnitCostSelection {
  readonly cost: string;
  readonly sourceType: CostSourceType;
  readonly observedAt: Date | string | null;
}

function canonicalCost(value: string): string {
  const units = parseDecimal(value, MONEY_SCALE);
  if (units < 0n) {
    throw new DomainError("selected base unit cost must not be negative");
  }
  return formatDecimal(units, MONEY_SCALE);
}

/**
 * `pack_price / pack_size`, rounded to 4 dp HALF_UP — the base-unit cost of a
 * cost observation whose `pack_size` is already in the item's base unit
 * (`recordGoodsReceipt` stores it that way). `pack_price` is money (4 dp) and
 * `pack_size` a quantity (6 dp).
 */
export function observationBaseUnitCost(packPrice: string, packSize: string): string {
  const price = parseDecimal(packPrice, MONEY_SCALE);
  const size = parseDecimal(packSize, QUANTITY_SCALE);
  if (size <= 0n) {
    throw new DomainError("cost observation pack_size must be positive to derive a base-unit cost");
  }
  if (price < 0n) {
    throw new DomainError("cost observation pack_price must not be negative");
  }
  return formatDecimal(divideRoundHalfUp(price * 10n ** 6n, size), MONEY_SCALE);
}

export function selectBaseUnitCost(
  input: SelectBaseUnitCostInput,
  currency = "NOK",
): BaseUnitCostSelection {
  void currency;
  if (input.supplierPrices.length > 0) {
    const latest = input.supplierPrices.reduce((newest, candidate) =>
      candidate.effectiveFrom.getTime() > newest.effectiveFrom.getTime() ? candidate : newest,
    );
    const tied = input.supplierPrices.filter(
      (candidate) => candidate.effectiveFrom.getTime() === latest.effectiveFrom.getTime(),
    );
    const distinct = new Set(tied.map((candidate) => canonicalCost(candidate.cost)));
    if (distinct.size > 1) {
      throw new DomainError(
        "ambiguous supplier price: two rows effective at the same instant disagree",
      );
    }
    return {
      cost: canonicalCost(latest.cost),
      sourceType: "supplier_price",
      observedAt: latest.effectiveFrom,
    };
  }

  if (input.observations.length > 0) {
    const latest = input.observations.reduce((newest, candidate) =>
      candidate.observedAt > newest.observedAt ? candidate : newest,
    );
    const tied = input.observations.filter(
      (candidate) => candidate.observedAt === latest.observedAt,
    );
    const distinct = new Set(tied.map((candidate) => canonicalCost(candidate.cost)));
    if (distinct.size > 1) {
      throw new DomainError(
        "ambiguous cost observation: two observations on the same date disagree",
      );
    }
    return {
      cost: canonicalCost(latest.cost),
      sourceType: "cost_observation",
      observedAt: latest.observedAt,
    };
  }

  if (input.currentCost !== null) {
    return {
      cost: canonicalCost(input.currentCost),
      sourceType: "current_cost",
      observedAt: null,
    };
  }

  throw new DomainError(
    "no cost source available for the item (approved supplier price, cost observation or current_cost)",
  );
}
