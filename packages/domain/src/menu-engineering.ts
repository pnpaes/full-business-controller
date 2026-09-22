import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Menu-engineering primitives (`RPT-005`, `DEC-109`, `04_CALCULATIONS.md` §4.11).
 *
 * The report classifies each product on popularity (its period units against
 * the median of the per-product units) and contribution (its contribution
 * before labour/fees against the median within its `product.category`). Both
 * thresholds are **computed**, never configured; there is no approved-target
 * table (`DEC-109` item 1/2). The definitions live here once and are reused by
 * the application read model (`ADR-0007`; metric definitions live once).
 *
 * Decimal only, never floats. The working scale of a median is `MONEY_SCALE`,
 * raised to the widest fraction the inputs carry (up to `QUANTITY_SCALE`, the
 * `numeric(19,6)` ceiling), so a quantity median stays at 6 dp and a money
 * median at 4 dp; an even count rounds HALF_UP at that scale (`DEC-024`). A
 * malformed decimal is a `DomainError`, never a silent default.
 */

/** The threshold statistic for the popularity threshold: a plain median. */
export const MENU_ENGINEERING_THRESHOLD_MEDIAN = "median";

/** The threshold statistic for the contribution threshold: a category median. */
export const MENU_ENGINEERING_THRESHOLD_CATEGORY_MEDIAN = "category_median";

/** The threshold statistics a menu-engineering response may name (`DEC-109` item 1). */
export type MenuEngineeringThresholdStatistic =
  typeof MENU_ENGINEERING_THRESHOLD_MEDIAN | typeof MENU_ENGINEERING_THRESHOLD_CATEGORY_MEDIAN;

/** The response caveat: both thresholds are computed medians, never configured targets. */
export const MENU_ENGINEERING_THRESHOLD_NOTE =
  "thresholds are computed medians over the report's source period — popularity from per-product units, contribution from the category-relative contribution before labour/fees — never configured targets";

/** The response caveat: contribution stops before labour, fees and overhead. */
export const MENU_ENGINEERING_CONTRIBUTION_NOTE =
  "contribution is net sales minus the moving-average ingredient cost (before direct labour, channel fees and allocated overhead); a full cost is not computable today";

/** A plain decimal string, capturing its fraction digits when present. */
const DECIMAL_PATTERN = /^[+-]?\d+(?:\.(\d+))?$/;

/**
 * The fraction-digit count of a decimal string, rejecting a malformed value and
 * anything past the `QUANTITY_SCALE` storage ceiling. The count is what lets the
 * median and comparison helpers work exactly at the widest scale present rather
 * than re-scaling every input to one fixed scale.
 */
function fractionDigits(value: string): number {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    throw new DomainError(`"${value}" is not a valid decimal string`);
  }
  const digits = match[1]?.length ?? 0;
  if (digits > QUANTITY_SCALE) {
    throw new DomainError(`"${value}" has more than ${QUANTITY_SCALE} decimal places`);
  }
  return digits;
}

/**
 * The exact median of `values` (`RPT-005`, `DEC-109` item 1), or `null` for an
 * empty input. The working scale is `MONEY_SCALE`, widened to the largest
 * fraction the inputs carry (up to `QUANTITY_SCALE`): a units median returns 6
 * dp, a money median 4 dp. An odd count is one of the values verbatim; an even
 * count is the mean of the two middle values, rounded HALF_UP at the working
 * scale (`DEC-024`, half away from zero). A malformed decimal is a `DomainError`.
 */
export function medianDecimal(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  let scale = MONEY_SCALE;
  for (const value of values) {
    const digits = fractionDigits(value);
    if (digits > scale) {
      scale = digits;
    }
  }
  const parsed = values
    .map((value) => parseDecimal(value, scale))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = parsed.length >> 1;
  const median =
    parsed.length % 2 === 1
      ? parsed[middle]!
      : divideRoundHalfUp(parsed[middle - 1]! + parsed[middle]!, 2n);
  return formatDecimal(median, scale);
}

/**
 * True when `value >= threshold`, compared exactly at the widest fraction the
 * two carry — decimal only, never a float. The equality boundary is `high`
 * (`DEC-109` item 1: "≥ the median"). A malformed decimal is a `DomainError`.
 */
export function isHighAgainst(value: string, threshold: string): boolean {
  const scale = Math.max(fractionDigits(value), fractionDigits(threshold));
  return parseDecimal(value, scale) >= parseDecimal(threshold, scale);
}
