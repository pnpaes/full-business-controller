import type { SalesReportGroup } from "@aquarela/application";
import { MONEY_SCALE, parseDecimal } from "@aquarela/domain";

/**
 * Presentation helpers for the Insights landing composition (`08_UI_UX.md`
 * §8.3/§8.4). Kept free of Next/DB/persistence imports so the labels can be
 * unit tested directly. Decimal strings stay decimal through comparison
 * (`DEC-024`): ranking parses the stored decimal string to BigInt, never to a
 * float.
 */

/**
 * The top `limit` groups by contribution before labour/fees, in descending
 * order. Ties keep the report's original order (a stable sort on the parsed
 * decimal only), so the preview is deterministic.
 */
export function topByContribution(
  groups: readonly SalesReportGroup[],
  limit: number,
): readonly SalesReportGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        compareDecimal(b.group.contributionBeforeLabour, a.group.contributionBeforeLabour) ||
        a.index - b.index,
    )
    .slice(0, Math.max(0, limit))
    .map(({ group }) => group);
}

/** Compares two `numeric(19,4)` decimal strings exactly (BigInt, no floats). */
function compareDecimal(a: string, b: string): number {
  const left = parseDecimal(a, MONEY_SCALE);
  const right = parseDecimal(b, MONEY_SCALE);
  return left === right ? 0 : left < right ? -1 : 1;
}
