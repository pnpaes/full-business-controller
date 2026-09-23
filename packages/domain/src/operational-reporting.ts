import { parseDecimal } from "./decimal";
import { QUANTITY_SCALE } from "./quantity";
import { yieldRate, yieldVariancePct } from "./production";

/**
 * Operational-reporting primitives (`RPT-004`, rows 13e/13f, `DEC-110`).
 *
 * `RPT-004` reports stock value/variance, production yield and waste
 * value/reasons, but the spec defines only the variance **quantity**
 * (`04_CALCULATIONS.md` §4.8). `DEC-110` resolves the yield figures: the report
 * carries **both** the stored `production_batch.yield_variance_pct` semantics
 * (actual vs planned output, a fraction) **and** the derived actual/planned
 * ratio, each computed from the batch totals over the report window.
 *
 * Both helpers are pure and decimal-only (never floats). They reuse the
 * existing `yieldVariancePct`/`yieldRate` definitions rather than restating the
 * formula (`ADR-0007`: the metric definition lives once), adding only the
 * undefined-input guard a *totals* read needs: when `plannedOutput <= 0` the
 * figure is undefined, so the helpers return `null` (a caller renders "n/a")
 * instead of throwing — a window may group a completed batch whose planned
 * output is null, summing to zero. A malformed decimal is still a `DomainError`
 * (via `parseDecimal`), never a silent default.
 */

/**
 * The stored-yield semantics over totals: `(actual − planned) / planned` as a
 * **fraction** at 6 dp HALF_UP, negative on under-yield, exactly as
 * `yieldVariancePct`; `null` when `plannedOutput <= 0` (undefined). This is the
 * aggregate of the per-batch stored `yield_variance_pct` (weighted by planned
 * output), so a group and its totals use one rule.
 */
export function yieldVariancePctFromTotals(
  plannedOutput: string,
  actualOutput: string,
): string | null {
  if (parseDecimal(plannedOutput, QUANTITY_SCALE) <= 0n) {
    return null;
  }
  return yieldVariancePct(plannedOutput, actualOutput);
}

/**
 * The derived ratio over totals: `actual / planned` at 6 dp (the `yieldRate`
 * definition), or `null` when `plannedOutput <= 0` (undefined). A ratio above 1
 * is a legitimate over-yield. Decimal only.
 */
export function yieldRatio(plannedOutput: string, actualOutput: string): string | null {
  if (parseDecimal(plannedOutput, QUANTITY_SCALE) <= 0n) {
    return null;
  }
  return yieldRate(actualOutput, plannedOutput);
}
