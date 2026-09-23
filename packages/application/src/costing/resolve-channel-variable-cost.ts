import {
  channelVariableCost,
  DomainError,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  perUnitFixedFee,
  QUANTITY_SCALE,
} from "@aquarela/domain";

import type { ChannelFeeRuleRecord } from "./types";

/**
 * `DEC-112` channel variable cost resolver. Reads every `channel_fee_rule`
 * effective for one channel at `asOf` and values each per unit:
 *
 * ```
 * commission_pct / processing_pct  = percentage_rate × (gross_price | net_price)   # B-money
 * fixed_per_order / delivery_subsidy / discount_funding
 *                                  = fixed_amount / units_per_order                # B-money
 * ```
 *
 * The per-rule amounts are summed at 4 dp. The `fee_basis` cross-check is
 * fail-closed: a percentage kind must not carry a `per_order` basis and a fixed
 * kind must carry only `per_order`. No effective rule = not resolved
 * (`undefined`), so the caller keeps its explicit input.
 */

const PERCENTAGE_KINDS = ["commission_pct", "processing_pct"] as const;
const FIXED_KINDS = ["fixed_per_order", "delivery_subsidy", "discount_funding"] as const;

export interface ResolveChannelVariableCostInput {
  readonly organizationId: string;
  readonly channelId: string;
  readonly asOf: Date;
  readonly grossPrice: string;
  readonly netPrice: string;
  /** Units per order for a fixed per-order fee; defaults to "1". */
  readonly unitsPerOrder?: string;
}

export interface ResolvedChannelVariableCost {
  readonly perUnitCost: string;
  readonly ruleIds: readonly string[];
}

/** The `fee_basis` amount for a percentage rule; rejects a `per_order` basis. */
function percentageBasisAmount(
  rule: ChannelFeeRuleRecord,
  grossPrice: string,
  netPrice: string,
): string {
  switch (rule.feeBasis) {
    case "gross_price":
      return grossPrice;
    case "net_price":
      return netPrice;
    default:
      throw new DomainError(
        `feeBasis "${rule.feeBasis}" is invalid for percentage feeKind "${rule.feeKind}"; a percentage kind requires feeBasis "gross_price" or "net_price" (DEC-112)`,
      );
  }
}

function percentageRuleAmount(
  rule: ChannelFeeRuleRecord,
  grossPrice: string,
  netPrice: string,
): string {
  if (rule.percentageRate === null) {
    throw new DomainError(`feeKind "${rule.feeKind}" requires a percentageRate (DEC-112)`);
  }
  return channelVariableCost({
    percentageFeeRate: rule.percentageRate,
    feeBasisAmount: percentageBasisAmount(rule, grossPrice, netPrice),
  });
}

function fixedRuleAmount(rule: ChannelFeeRuleRecord, unitsPerOrder: string): string {
  if (rule.feeBasis !== "per_order") {
    throw new DomainError(`feeKind "${rule.feeKind}" requires feeBasis "per_order" (DEC-112)`);
  }
  if (rule.fixedAmount === null) {
    throw new DomainError(`feeKind "${rule.feeKind}" requires a fixedAmount (DEC-112)`);
  }
  // Validated here, not up front: a percentage-only channel never uses it.
  if (parseDecimal(unitsPerOrder, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("unitsPerOrder must be a positive decimal with at most 6 decimal places");
  }
  const perUnit = perUnitFixedFee(rule.fixedAmount, unitsPerOrder);
  // A fixed fee is a zero-rate percentage plus the fixed per-unit fee: passing it
  // as `feeBasisAmount` under a zero rate would (correctly) yield 0, so it must go
  // through `fixedOrderFeePerUnit` to cross the B-money boundary.
  return channelVariableCost({
    percentageFeeRate: "0",
    feeBasisAmount: "0",
    fixedOrderFeePerUnit: perUnit,
  });
}

function ruleAmount(
  rule: ChannelFeeRuleRecord,
  grossPrice: string,
  netPrice: string,
  unitsPerOrder: string,
): string {
  if ((PERCENTAGE_KINDS as readonly string[]).includes(rule.feeKind)) {
    return percentageRuleAmount(rule, grossPrice, netPrice);
  }
  if ((FIXED_KINDS as readonly string[]).includes(rule.feeKind)) {
    return fixedRuleAmount(rule, unitsPerOrder);
  }
  // Fail closed: an unknown fee kind is a data-integrity failure, never a silent skip.
  throw new DomainError(`unknown feeKind "${rule.feeKind}"`);
}

export async function resolveChannelVariableCost(
  store: {
    listEffectiveChannelFeeRules(query: {
      readonly organizationId: string;
      readonly channelId: string;
      readonly asOf: Date;
    }): Promise<readonly ChannelFeeRuleRecord[]>;
  },
  input: ResolveChannelVariableCostInput,
): Promise<ResolvedChannelVariableCost | undefined> {
  const unitsPerOrder = input.unitsPerOrder ?? "1";

  const rules = await store.listEffectiveChannelFeeRules({
    organizationId: input.organizationId,
    channelId: input.channelId,
    asOf: input.asOf,
  });
  if (rules.length === 0) {
    return undefined;
  }

  let total = 0n;
  for (const rule of rules) {
    const amount = ruleAmount(rule, input.grossPrice, input.netPrice, unitsPerOrder);
    total += parseDecimal(amount, MONEY_SCALE);
  }

  return {
    perUnitCost: formatDecimal(total, MONEY_SCALE),
    ruleIds: rules.map((rule) => rule.id),
  };
}
