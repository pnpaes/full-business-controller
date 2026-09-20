import { formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { fullCostMargin, unitFullCost } from "./allocation";
import { contributionBeforeAndAfterDirectLabor } from "./labour";
import { MONEY_SCALE } from "./money";
import { contributionMarginPct, unitVariableCost } from "./pricing";

/**
 * Cost-card totals (COST-005/007/008, CALCULATION_CONTRACT §7–§9): the
 * ingredients + packaging + channel + other variable costs, the two mandatory
 * labour views, the full cost with allocated overhead and the margins. Every
 * money figure is 4 dp; the margin percentages are 6 dp (or `null`, rendering
 * "n/a", when net sales are non-positive).
 *
 * This composes the existing primitives — it never re-implements them.
 */

export interface CostCardCompositionInput {
  readonly currency: string;
  readonly ingredientCost: string;
  readonly packagingCost: string;
  readonly directLaborCost: string;
  readonly channelVariableCost: string;
  readonly otherVariableCost: string;
  readonly unitNetSales: string;
  readonly allocatedUnitOverhead: string;
}

export interface CostCardTotals {
  readonly currency: string;
  /** Variable cost before direct labour (ingredient + packaging + channel + other), 4 dp. */
  readonly unitVariableCostBeforeLabor: string;
  /** Variable cost after direct labour, 4 dp. */
  readonly unitVariableCost: string;
  readonly contributionBeforeDirectLabor: string;
  readonly contributionAfterDirectLabor: string;
  readonly contributionMarginPctBeforeLabor: string | null;
  readonly contributionMarginPctAfterLabor: string | null;
  readonly unitFullCost: string;
  readonly fullCostMargin: string;
}

/** Computes the cost-card totals from its components, at the documented boundaries. */
export function computeCostCardTotals(input: CostCardCompositionInput): CostCardTotals {
  const labor = parseDecimal(input.directLaborCost, MONEY_SCALE);
  if (labor < 0n) {
    throw new DomainError("directLaborCost must not be negative");
  }

  const unitVariableCostBeforeLabor = unitVariableCost({
    ingredientCost: input.ingredientCost,
    packagingCost: input.packagingCost,
    channelVariableCost: input.channelVariableCost,
    otherVariableCost: input.otherVariableCost,
  });
  const totalVariableCost = formatDecimal(
    parseDecimal(unitVariableCostBeforeLabor, MONEY_SCALE) + labor,
    MONEY_SCALE,
  );

  const contributions = contributionBeforeAndAfterDirectLabor({
    unitNetSales: input.unitNetSales,
    variableCostBeforeLabor: unitVariableCostBeforeLabor,
    directLaborCost: input.directLaborCost,
  });

  const unitFullCostValue = unitFullCost(totalVariableCost, input.allocatedUnitOverhead);

  return {
    currency: input.currency,
    unitVariableCostBeforeLabor,
    unitVariableCost: totalVariableCost,
    contributionBeforeDirectLabor: contributions.contributionBeforeDirectLabor,
    contributionAfterDirectLabor: contributions.contributionAfterDirectLabor,
    contributionMarginPctBeforeLabor: contributionMarginPct(
      input.unitNetSales,
      contributions.contributionBeforeDirectLabor,
    ),
    contributionMarginPctAfterLabor: contributionMarginPct(
      input.unitNetSales,
      contributions.contributionAfterDirectLabor,
    ),
    unitFullCost: unitFullCostValue,
    fullCostMargin: fullCostMargin(input.unitNetSales, unitFullCostValue),
  };
}
