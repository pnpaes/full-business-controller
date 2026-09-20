import { MONEY_SCALE, QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

/**
 * Variance assessment for a just-recorded receipt (08_UI_UX.md §8.3: receiving
 * surfaces "variance warnings" next to the quantity/price the user entered).
 *
 * Two variances are computed from facts the record command already returns, so
 * nothing is fabricated: the accepted/received pack shortfall the user typed, and
 * the change of landed base-unit cost against the price window that was open
 * before this receipt. The threshold is a presentation rule, not a costing rule.
 */

/** Price changes at or above this rule of thumb are flagged (5%). */
export const PRICE_VARIANCE_THRESHOLD_BPS = 500;

export interface ReceiptVarianceWarning {
  /** 0-based index into the submitted line list. */
  readonly lineIndex: number;
  readonly kind: "price" | "quantity";
  readonly severity: "warning" | "info";
  readonly message: string;
}

export interface ReceiptVarianceLine {
  /** 0-based index into the submitted line list. */
  readonly lineIndex: number;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  /** The landed base-unit cost of the price window open before this receipt. */
  readonly previousLandedBaseUnitCost: string | null;
  readonly landedBaseUnitCost: string;
}

/** Basis points as `"12.50%"` without floating point. */
function formatBps(bps: bigint): string {
  const whole = bps / 100n;
  const fraction = (bps % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

function ratioBps(part: bigint, whole: bigint): bigint {
  return whole === 0n ? 0n : (part * 10_000n) / whole;
}

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

function quantityLabel(value: bigint): string {
  return trimDecimal(formatDecimal(value, QUANTITY_SCALE));
}

function moneyLabel(value: bigint): string {
  return trimDecimal(formatDecimal(value, MONEY_SCALE));
}

/**
 * Warnings for one receipt's lines, in line order. A price warning needs a prior
 * window (`previousLandedBaseUnitCost` null on a first purchase), and a quantity
 * warning needs an accepted shortfall; a clean line produces nothing.
 */
export function assessReceiptVariances(
  lines: readonly ReceiptVarianceLine[],
): readonly ReceiptVarianceWarning[] {
  const warnings: ReceiptVarianceWarning[] = [];
  for (const line of lines) {
    const received = parseDecimal(line.receivedPackQty, QUANTITY_SCALE);
    const accepted = parseDecimal(line.acceptedPackQty, QUANTITY_SCALE);
    if (accepted < received) {
      const rejected = received - accepted;
      warnings.push({
        lineIndex: line.lineIndex,
        kind: "quantity",
        severity: "warning",
        message: `Line ${line.lineIndex + 1}: ${quantityLabel(rejected)} of ${quantityLabel(
          received,
        )} packs not accepted (${formatBps(ratioBps(rejected, received))}).`,
      });
    }

    if (line.previousLandedBaseUnitCost !== null) {
      const previous = parseDecimal(line.previousLandedBaseUnitCost, MONEY_SCALE);
      const next = parseDecimal(line.landedBaseUnitCost, MONEY_SCALE);
      if (previous > 0n && next !== previous) {
        const change = next > previous ? next - previous : previous - next;
        const bps = ratioBps(change, previous);
        if (bps >= BigInt(PRICE_VARIANCE_THRESHOLD_BPS)) {
          warnings.push({
            lineIndex: line.lineIndex,
            kind: "price",
            severity: "warning",
            message: `Line ${line.lineIndex + 1}: landed unit cost ${moneyLabel(
              next,
            )} changed ${formatBps(bps)} from ${moneyLabel(previous)}.`,
          });
        }
      }
    }
  }
  return warnings;
}
