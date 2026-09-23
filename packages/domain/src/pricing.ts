import { divideRoundHalfUp, formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Net sales, channel fees and price scenarios (PRICE-001/004,
 * CALCULATION_CONTRACT §7/§8/§10). Decimal only (never floats); HALF_UP once per
 * named boundary (`DEC-024`):
 *
 * ```
 * net_from_gross    = gross / (1 + tax_rate)                 # inclusive basis, B-money
 * gross_from_net    = net × (1 + tax_rate)                   # B-money
 * included_tax      = gross − net_from_gross                 # B-money
 * unit_net_sales    = gross − included_tax − discount − refund   # B-money
 * channel_var_cost  = percentage_fee_rate × fee_basis_amount + fixed_order_fee_per_unit   # B-money
 * unit_variable_cost = ingredient + packaging + channel + other  # B-money
 * unit_contribution = unit_net_sales − unit_variable_cost        # B-money
 * margin_pct        = unit_contribution / unit_net_sales × 100   # 6 dp, never a money boundary
 * required_net_price = unit_variable_cost / (1 − target_contribution_rate)   # B-money
 * break_even_units  = fixed_cost / contribution_per_unit     # quantity 6 dp
 * ```
 *
 * Rates are fractions carried at 6 dp (`numeric(9,6)`): 15 % is `"0.150000"`.
 * A margin percentage against non-positive net sales is undefined and returned
 * as `null` so it renders as "n/a", never 0 (§8). A target rate of 1 or more,
 * and a non-positive contribution per unit, are unattainable and rejected
 * rather than divided silently (§12.6/§12.7).
 */

/** Presented money boundary B4 (`DEC-024`): 2 dp for display/report only. */
export const PRESENTED_MONEY_SCALE = 2;

/** Tax rates and percentage outputs are carried at `numeric(9,6)` (`DEC-024`). */
export const TAX_RATE_SCALE = 6;

/** Fraction of one at the rate scale: `1.000000`. */
const ONE = 1_000_000n;

export const TAX_BASES = ["inclusive", "exclusive"] as const;
export type TaxBasis = (typeof TAX_BASES)[number];

/** Parses a fraction at the rate scale, rejecting a negative rate. */
function parseRate(value: string, field: string): bigint {
  const rate = parseDecimal(value, TAX_RATE_SCALE);
  if (rate < 0n) {
    throw new DomainError(`${field} must not be negative`);
  }
  return rate;
}

/**
 * `net = gross / (1 + taxRate)`, at 4 dp HALF_UP — the inclusive tax basis
 * (DEC-003/DEC-022). Rejects a negative rate.
 */
export function netFromGross(grossAmount: string, taxRate: string): string {
  const gross = parseDecimal(grossAmount, MONEY_SCALE);
  const rate = parseRate(taxRate, "taxRate");
  return formatDecimal(divideRoundHalfUp(gross * ONE, ONE + rate), MONEY_SCALE);
}

/** `gross = net × (1 + taxRate)`, at 4 dp HALF_UP. Rejects a negative rate. */
export function grossFromNet(netAmount: string, taxRate: string): string {
  const net = parseDecimal(netAmount, MONEY_SCALE);
  const rate = parseRate(taxRate, "taxRate");
  return formatDecimal(divideRoundHalfUp(net * (ONE + rate), ONE), MONEY_SCALE);
}

/** `includedTax = gross − netFromGross(gross, taxRate)`, at 4 dp. */
export function includedTax(grossAmount: string, taxRate: string): string {
  const gross = parseDecimal(grossAmount, MONEY_SCALE);
  const net = parseDecimal(netFromGross(grossAmount, taxRate), MONEY_SCALE);
  return formatDecimal(gross - net, MONEY_SCALE);
}

/** B4: presents a money amount at 2 dp HALF_UP. Display/report only. */
export function presentedMoney(amount: string): string {
  return formatDecimal(
    rescale(parseDecimal(amount, MONEY_SCALE), MONEY_SCALE, PRESENTED_MONEY_SCALE),
    PRESENTED_MONEY_SCALE,
  );
}

export interface UnitNetSalesInput {
  /** The channel's gross sales price, a money string. */
  readonly grossSales: string;
  readonly taxBasis: TaxBasis;
  readonly taxRate: string;
  /** Optional unit discount, `>= 0`, default `"0"`. */
  readonly discount?: string;
  /** Optional unit refund, `>= 0`, default `"0"`. */
  readonly refund?: string;
}

/**
 * `unit_net_sales = gross − included_tax − discount − refund` (§8). The net
 * amount is `netFromGross` on the inclusive basis and the gross amount itself on
 * the exclusive basis. Rejects a negative discount/refund and an unknown
 * `taxBasis`. On the exclusive basis `taxRate` is ignored — the gross amount is
 * already net of tax, so the parameter is intentionally unused on that branch.
 */
export function unitNetSales(input: UnitNetSalesInput): string {
  if (!(TAX_BASES as readonly string[]).includes(input.taxBasis)) {
    throw new DomainError(`unknown taxBasis "${input.taxBasis}"`);
  }
  const discount = parseDecimal(input.discount ?? "0", MONEY_SCALE);
  const refund = parseDecimal(input.refund ?? "0", MONEY_SCALE);
  if (discount < 0n) {
    throw new DomainError("discount must not be negative");
  }
  if (refund < 0n) {
    throw new DomainError("refund must not be negative");
  }

  const net =
    input.taxBasis === "inclusive"
      ? parseDecimal(netFromGross(input.grossSales, input.taxRate), MONEY_SCALE)
      : parseDecimal(input.grossSales, MONEY_SCALE);
  return formatDecimal(net - discount - refund, MONEY_SCALE);
}

export interface ChannelVariableCostInput {
  readonly percentageFeeRate: string;
  readonly feeBasisAmount: string;
  /** Optional fixed per-unit order fee, `>= 0`, default `"0"`. */
  readonly fixedOrderFeePerUnit?: string;
}

/**
 * `channel_variable_cost = percentage_fee_rate × fee_basis_amount +
 * fixed_order_fee_per_unit`, rounded once at 4 dp (B-money, §7). Rejects a
 * negative fee rate, basis or fixed fee.
 */
export function channelVariableCost(input: ChannelVariableCostInput): string {
  const rate = parseRate(input.percentageFeeRate, "percentageFeeRate");
  const basis = parseDecimal(input.feeBasisAmount, MONEY_SCALE);
  const fixed = parseDecimal(input.fixedOrderFeePerUnit ?? "0", MONEY_SCALE);
  if (basis < 0n) {
    throw new DomainError("feeBasisAmount must not be negative");
  }
  if (fixed < 0n) {
    throw new DomainError("fixedOrderFeePerUnit must not be negative");
  }
  // rate (6 dp) × basis (4 dp), lifted back to 4 dp in one HALF_UP step.
  return formatDecimal(divideRoundHalfUp(rate * basis, ONE) + fixed, MONEY_SCALE);
}

/**
 * `per_unit_fixed_fee = round(fixed_amount / units_per_order, 4 dp, HALF_UP)`
 * (`DEC-112`). Allocates a fixed per-order channel fee (`fixed_per_order`,
 * `delivery_subsidy`, `discount_funding`) across an explicit `unitsPerOrder`;
 * the order-size allocation is a recorded `[PROPOSED]` in `DEC-112`.
 *
 * With scaled bigints `f` (fixed, 4 dp) and `u` (units, 6 dp),
 *
 * ```
 * value         = (f/10^4) / (u/10^6) = f·10^2 / u
 * result_scaled = 10^4 × value = f·10^6 / u
 * ```
 *
 * so the 4 dp result is `divideRoundHalfUp(f * 10^6, u)`. Rejects a negative
 * `fixedAmount` and a non-positive `unitsPerOrder` — the code never divides
 * silently (§12.6).
 */
export function perUnitFixedFee(fixedAmount: string, unitsPerOrder: string): string {
  const fixed = parseDecimal(fixedAmount, MONEY_SCALE);
  const units = parseDecimal(unitsPerOrder, QUANTITY_SCALE);
  if (fixed < 0n) {
    throw new DomainError("fixedAmount must not be negative");
  }
  if (units <= 0n) {
    throw new DomainError("unitsPerOrder must be positive");
  }
  return formatDecimal(
    divideRoundHalfUp(fixed * 10n ** BigInt(QUANTITY_SCALE), units),
    MONEY_SCALE,
  );
}

export interface UnitVariableCostInput {
  readonly ingredientCost: string;
  readonly packagingCost: string;
  readonly channelVariableCost: string;
  readonly otherVariableCost: string;
}

/** `unit_variable_cost = ingredient + packaging + channel + other`, at 4 dp. */
export function unitVariableCost(input: UnitVariableCostInput): string {
  const ingredient = parseDecimal(input.ingredientCost, MONEY_SCALE);
  const packaging = parseDecimal(input.packagingCost, MONEY_SCALE);
  const channel = parseDecimal(input.channelVariableCost, MONEY_SCALE);
  const other = parseDecimal(input.otherVariableCost, MONEY_SCALE);
  if (ingredient < 0n) {
    throw new DomainError("ingredientCost must not be negative");
  }
  if (packaging < 0n) {
    throw new DomainError("packagingCost must not be negative");
  }
  if (channel < 0n) {
    throw new DomainError("channelVariableCost must not be negative");
  }
  if (other < 0n) {
    throw new DomainError("otherVariableCost must not be negative");
  }
  return formatDecimal(ingredient + packaging + channel + other, MONEY_SCALE);
}

/**
 * `unit_contribution = unit_net_sales − unit_variable_cost`, at 4 dp (§8). The
 * contribution may be negative; the variable cost must not be.
 */
export function unitContribution(unitNetSales: string, unitVariableCost: string): string {
  const netSales = parseDecimal(unitNetSales, MONEY_SCALE);
  const variableCost = parseDecimal(unitVariableCost, MONEY_SCALE);
  if (variableCost < 0n) {
    throw new DomainError("unitVariableCost must not be negative");
  }
  return formatDecimal(netSales - variableCost, MONEY_SCALE);
}

/**
 * `contribution_margin_pct = unit_contribution / unit_net_sales × 100`, stored
 * at 6 dp (never rounded to a money boundary, §1/§8). Returns `null` when
 * `unitNetSales <= 0`, where the percentage is undefined and must render as
 * "n/a", never 0.
 */
export function contributionMarginPct(
  unitNetSales: string,
  unitContribution: string,
): string | null {
  const netSales = parseDecimal(unitNetSales, MONEY_SCALE);
  const contribution = parseDecimal(unitContribution, MONEY_SCALE);
  if (netSales <= 0n) {
    return null;
  }
  return formatDecimal(divideRoundHalfUp(contribution * 100n * ONE, netSales), TAX_RATE_SCALE);
}

/**
 * `required_net_price = unit_variable_cost / (1 − target_contribution_rate)`,
 * at 4 dp (§10). Rejects a target of 1 or more (unattainable, §12.7) and a
 * negative target or variable cost.
 */
export function requiredNetPrice(unitVariableCost: string, targetContributionRate: string): string {
  const variableCost = parseDecimal(unitVariableCost, MONEY_SCALE);
  const target = parseDecimal(targetContributionRate, TAX_RATE_SCALE);
  if (variableCost < 0n) {
    throw new DomainError("unitVariableCost must not be negative");
  }
  if (target < 0n || target >= ONE) {
    throw new DomainError("targetContributionRate must be in [0, 1)");
  }
  return formatDecimal(divideRoundHalfUp(variableCost * ONE, ONE - target), MONEY_SCALE);
}

/**
 * `break_even_units = fixed_cost / contribution_per_unit`, at quantity 6 dp
 * (§10). Rejects a negative fixed cost and a non-positive contribution per unit
 * — the code never divides silently.
 */
export function breakEvenUnits(fixedCost: string, contributionPerUnit: string): string {
  const fixed = parseDecimal(fixedCost, MONEY_SCALE);
  const contribution = parseDecimal(contributionPerUnit, MONEY_SCALE);
  if (fixed < 0n) {
    throw new DomainError("fixedCost must not be negative");
  }
  if (contribution <= 0n) {
    throw new DomainError("contributionPerUnit must be positive");
  }
  return formatDecimal(divideRoundHalfUp(fixed * ONE, contribution), QUANTITY_SCALE);
}

/**
 * Effective-window helpers for price versions (`DEC-077`). Windows are
 * half-open `[effectiveFrom, effectiveTo)` over ISO-8601 instant strings, the
 * representation used elsewhere in the domain. Instants are compared by parsed
 * time rather than raw string so an offset or differing precision cannot break
 * ordering; an unparseable instant is rejected.
 */
export interface PriceVersionWindow {
  /** ISO instant, inclusive. */
  readonly effectiveFrom: string;
  /** ISO instant, exclusive; null = open-ended. */
  readonly effectiveTo: string | null;
}

/** Parses an ISO-8601 instant to epoch millis, rejecting an invalid value. */
function parseInstant(value: string, field: string): number {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    throw new DomainError(`${field} must be a valid ISO-8601 instant, got "${value}"`);
  }
  return time;
}

/** Half-open `[effectiveFrom, effectiveTo)`: `asOf >= from && (to === null || asOf < to)`. */
export function isEffectiveAt(window: PriceVersionWindow, asOf: string): boolean {
  const at = parseInstant(asOf, "asOf");
  const from = parseInstant(window.effectiveFrom, "effectiveFrom");
  const to = window.effectiveTo === null ? null : parseInstant(window.effectiveTo, "effectiveTo");
  return from <= at && (to === null || at < to);
}

/** Half-open overlap of two windows: `a.from < b.to && b.from < a.to` (null = open end). */
export function priceVersionWindowsOverlap(a: PriceVersionWindow, b: PriceVersionWindow): boolean {
  const aFrom = parseInstant(a.effectiveFrom, "effectiveFrom");
  const bFrom = parseInstant(b.effectiveFrom, "effectiveFrom");
  const aTo = a.effectiveTo === null ? null : parseInstant(a.effectiveTo, "effectiveTo");
  const bTo = b.effectiveTo === null ? null : parseInstant(b.effectiveTo, "effectiveTo");
  const aStartsBeforeBEnds = bTo === null || aFrom < bTo;
  const bStartsBeforeAEnds = aTo === null || bFrom < aTo;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/**
 * The single version effective at `asOf`, or undefined. Throws `DomainError`
 * when more than one is effective — an ambiguous set the DB exclusion
 * constraint forbids, so it is a data-integrity failure, not a case to resolve
 * by guessing (mirrors `selectEffectiveRecipeVersion`).
 */
export function selectEffectivePriceVersion<T extends PriceVersionWindow>(
  versions: readonly T[],
  asOf: string,
): T | undefined {
  const effective = versions.filter((version) => isEffectiveAt(version, asOf));
  if (effective.length > 1) {
    throw new DomainError("more than one price version is effective at the requested instant");
  }
  return effective[0];
}
