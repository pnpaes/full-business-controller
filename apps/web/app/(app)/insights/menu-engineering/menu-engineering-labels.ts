import type { MenuEngineeringThreshold, MenuEngineeringWaste } from "@aquarela/application";
import { MENU_ENGINEERING_THRESHOLD_MEDIAN } from "@aquarela/domain";

import { formatMoney, formatQuantity } from "../reports/report-labels";

/**
 * Presentation helpers for the menu-engineering screen (`RPT-005`, `08_UI_UX.md`
 * §8.3/§8.4). Kept free of Next/DB/persistence imports so the labels can be unit
 * tested directly. Decimal strings stay decimal through formatting (`DEC-024`).
 *
 * A threshold is always rendered with its **value** and its **source period**,
 * never as a bare label (`04_CALCULATIONS.md` §4.11, `DEC-109` item 1).
 */

/** `true` → "High", `false` → "Low". No Star/Puzzle/Horse/Dog names (`DEC-109` item 2). */
export function classificationLabel(high: boolean): string {
  return high ? "High" : "Low";
}

/** An ISO instant range → "2026-09-01 – 2026-09-30" (the threshold's source period). */
export function sourcePeriodLabel(sourcePeriod: {
  readonly start: string;
  readonly end: string;
}): string {
  return `${sourcePeriod.start.slice(0, 10)} – ${sourcePeriod.end.slice(0, 10)}`;
}

/**
 * A threshold's value with its unit: "5 units" for the popularity median, money
 * for a single contribution threshold, or "category-relative (per row)" when the
 * statistic has no single value (`DEC-109` item 1).
 */
export function thresholdValueLabel(threshold: MenuEngineeringThreshold): string {
  if (threshold.value === null) {
    return threshold.statistic === MENU_ENGINEERING_THRESHOLD_MEDIAN
      ? "n/a"
      : "category-relative (per row)";
  }
  return threshold.statistic === MENU_ENGINEERING_THRESHOLD_MEDIAN
    ? `${formatQuantity(threshold.value)} units`
    : `${formatMoney(threshold.value)} NOK`;
}

/** The waste annotation for a row, or "—" when no waste event names the variant. */
export function wasteLabel(waste: MenuEngineeringWaste | null): string {
  if (waste === null) {
    return "—";
  }
  const quantity = formatQuantity(waste.quantity);
  return waste.value === null ? quantity : `${quantity} · ${formatMoney(waste.value)} NOK`;
}
