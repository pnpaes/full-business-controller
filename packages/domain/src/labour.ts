import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { unitContribution } from "./pricing";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Loaded labour rate, direct labour cost and the two labour views
 * (COST-004/006/013, CALCULATION_CONTRACT §7, LABOUR_ASSUMPTIONS §3–§5):
 *
 * ```
 * feriepenger        = round(0.102 × base, 2 dp, HALF_UP)
 * arbeidsgiveravgift = round(0.141 × (base + feriepenger), 2 dp, HALF_UP)   # on the ROUNDED feriepenger
 * pensjon            = round(0.02  × base, 2 dp, HALF_UP)
 * loaded             = base + feriepenger + arbeidsgiveravgift + pensjon
 * direct_labor_cost  = round(productive_minutes / 60 × loaded_hourly_rate, 4 dp, HALF_UP)   # B-money
 * ```
 *
 * Decimal only (never floats). The statutory components are rounded to 2 dp
 * **before** the compounded employer contribution is taken and the total summed
 * ("all values rounded to 2 dp", LABOUR_ASSUMPTIONS §3), so the returned
 * components always add up to `loadedHourlyRate`. The owner's production hours
 * are imputed at the kitchen loaded rate (DEC-048 / COST-013) and reported in
 * both the economic and cash views.
 */

/** LABOUR_ASSUMPTIONS §3 ("All values rounded to 2 dp"). */
export const LOADED_RATE_SCALE = 2;

/** Rate/percentage scale (`numeric(9,6)`, DEC-024). */
const RATE_SCALE = 6;
const RATE_ONE = 10n ** BigInt(RATE_SCALE);

/** `10^(money_scale − loaded_scale)`, to lift 2 dp components into money scale. */
const LOADED_TO_MONEY = 10n ** BigInt(MONEY_SCALE - LOADED_RATE_SCALE);

/** `10^(money_scale + rate_scale − loaded_scale)`, the divisor for a 2 dp percentage product. */
const PERCENT_DIVISOR = 10n ** BigInt(MONEY_SCALE + RATE_SCALE - LOADED_RATE_SCALE);

const DEFAULT_FERIEPENGER_PCT = "0.102000";
const DEFAULT_EMPLOYER_CONTRIBUTION_PCT = "0.141000";
const DEFAULT_PENSION_PCT = "0.020000";

/** Parses a percentage/rate at 6 dp; §3's rates are all fractions in `[0,1]`. */
function parsePercentage(value: string, field: string): bigint {
  const pct = parseDecimal(value, RATE_SCALE);
  if (pct < 0n || pct > RATE_ONE) {
    throw new DomainError(`${field} must be in [0, 1]`);
  }
  return pct;
}

export interface ComputeLoadedRateInput {
  /** Base hourly wage, a money string (`>= 0`). */
  readonly baseHourlyRate: string;
  readonly feriepengerPct?: string;
  readonly employerContributionPct?: string;
  readonly pensionPct?: string;
}

export interface LoadedRateComponents {
  readonly baseHourlyRate: string;
  readonly feriepenger: string;
  readonly employerContribution: string;
  readonly pension: string;
  readonly loadedHourlyRate: string;
}

/**
 * The compounded loaded hourly rate (LABOUR_ASSUMPTIONS §3, DEC-006): each
 * statutory component rounded to 2 dp and then summed with the base. Rejects a
 * negative base rate and a percentage outside `[0,1]`.
 */
export function computeLoadedHourlyRate(input: ComputeLoadedRateInput): LoadedRateComponents {
  const base = parseDecimal(input.baseHourlyRate, MONEY_SCALE);
  if (base < 0n) {
    throw new DomainError("baseHourlyRate must not be negative");
  }
  const feriePengerPct = parsePercentage(
    input.feriepengerPct ?? DEFAULT_FERIEPENGER_PCT,
    "feriepengerPct",
  );
  const employerPct = parsePercentage(
    input.employerContributionPct ?? DEFAULT_EMPLOYER_CONTRIBUTION_PCT,
    "employerContributionPct",
  );
  const pensionPct = parsePercentage(input.pensionPct ?? DEFAULT_PENSION_PCT, "pensionPct");

  // Each component crosses the 2 dp boundary once (HALF_UP). The employer
  // contribution base is the *rounded* feriepenger, so the AG amount matches the
  // component the caller is shown.
  const feriepenger = divideRoundHalfUp(base * feriePengerPct, PERCENT_DIVISOR);
  const arbeidsgiverBase = base + feriepenger * LOADED_TO_MONEY;
  const employerContribution = divideRoundHalfUp(arbeidsgiverBase * employerPct, PERCENT_DIVISOR);
  const pension = divideRoundHalfUp(base * pensionPct, PERCENT_DIVISOR);

  const baseHourlyRate = divideRoundHalfUp(base, LOADED_TO_MONEY);
  const loadedHourlyRate = baseHourlyRate + feriepenger + employerContribution + pension;

  return {
    baseHourlyRate: formatDecimal(baseHourlyRate, LOADED_RATE_SCALE),
    feriepenger: formatDecimal(feriepenger, LOADED_RATE_SCALE),
    employerContribution: formatDecimal(employerContribution, LOADED_RATE_SCALE),
    pension: formatDecimal(pension, LOADED_RATE_SCALE),
    loadedHourlyRate: formatDecimal(loadedHourlyRate, LOADED_RATE_SCALE),
  };
}

/**
 * `loaded_per_productive_hour = loaded_per_paid_hour / productive_hours_pct`,
 * at 2 dp HALF_UP (LABOUR_ASSUMPTIONS §4). `productiveHoursPct` must be in
 * `(0,1]`; a share of zero would make the loaded per-productive-hour rate
 * undefined.
 */
export function applyProductiveHoursPct(
  loadedHourlyRate: string,
  productiveHoursPct: string,
): string {
  const rate = parseDecimal(loadedHourlyRate, LOADED_RATE_SCALE);
  const pct = parseDecimal(productiveHoursPct, RATE_SCALE);
  if (pct <= 0n || pct > RATE_ONE) {
    throw new DomainError("productiveHoursPct must be in (0, 1]");
  }
  // rate (2 dp) / pct (6 dp), scaled back to 2 dp in one HALF_UP step.
  return formatDecimal(divideRoundHalfUp(rate * RATE_ONE, pct), LOADED_RATE_SCALE);
}

/**
 * `direct_labor_cost = round(productive_minutes / 60 × loaded_hourly_rate, 4 dp)`
 * (CALCULATION_CONTRACT §7, B-money). Minutes are parsed at quantity scale
 * (6 dp) and the rate at 2 dp; the single HALF_UP division is
 * `minutes × rate / 600000`.
 */
export function directLaborCost(productiveMinutes: string, loadedHourlyRate: string): string {
  const minutes = parseDecimal(productiveMinutes, QUANTITY_SCALE);
  const rate = parseDecimal(loadedHourlyRate, LOADED_RATE_SCALE);
  return formatDecimal(divideRoundHalfUp(minutes * rate, 600_000n), MONEY_SCALE);
}

export interface LabourCostViewsInput {
  readonly paidDirectLabor: string;
  /** Imputed owner production labour (DEC-048); excluded from the cash view. */
  readonly imputedOwnerLabor?: string;
}

export interface LabourCostViews {
  /** Paid + imputed (DEC-048), 4 dp. */
  readonly economicView: string;
  /** Paid only (the statutory/cash P&L shows no imputed salary), 4 dp. */
  readonly cashView: string;
}

/** Economic (imputed owner labour included) and cash (excluded) direct-labour views. */
export function labourCostViews(input: LabourCostViewsInput): LabourCostViews {
  const paid = parseDecimal(input.paidDirectLabor, MONEY_SCALE);
  const imputed = parseDecimal(input.imputedOwnerLabor ?? "0", MONEY_SCALE);
  if (paid < 0n) {
    throw new DomainError("paidDirectLabor must not be negative");
  }
  if (imputed < 0n) {
    throw new DomainError("imputedOwnerLabor must not be negative");
  }
  return {
    economicView: formatDecimal(paid + imputed, MONEY_SCALE),
    cashView: formatDecimal(paid, MONEY_SCALE),
  };
}

/**
 * The mandatory two labour views in contribution (COST-006, DEC-006,
 * CALCULATION_CONTRACT §7): before and after standard direct labour, both at
 * 4 dp. `unitNetSales` may be negative (a loss-making unit is still a valid
 * figure); the cost components must not be.
 *
 * Both views delegate to `unitContribution` (§8) so the contribution boundary
 * has a single authority; the after-labour variable cost is the exact 4 dp sum
 * of the before-labour cost and the direct labour cost.
 */
export function contributionBeforeAndAfterDirectLabor(input: {
  readonly unitNetSales: string;
  readonly variableCostBeforeLabor: string;
  readonly directLaborCost: string;
}): {
  readonly contributionBeforeDirectLabor: string;
  readonly contributionAfterDirectLabor: string;
} {
  const variableCost = parseDecimal(input.variableCostBeforeLabor, MONEY_SCALE);
  const labor = parseDecimal(input.directLaborCost, MONEY_SCALE);
  if (variableCost < 0n) {
    throw new DomainError("variableCostBeforeLabor must not be negative");
  }
  if (labor < 0n) {
    throw new DomainError("directLaborCost must not be negative");
  }
  const variableCostAfterLabor = formatDecimal(variableCost + labor, MONEY_SCALE);
  return {
    contributionBeforeDirectLabor: unitContribution(
      input.unitNetSales,
      input.variableCostBeforeLabor,
    ),
    contributionAfterDirectLabor: unitContribution(input.unitNetSales, variableCostAfterLabor),
  };
}
