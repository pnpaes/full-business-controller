import { DomainError, MONEY_SCALE, parseDecimal } from "@aquarela/domain";
import { FEE_BASIS, FEE_KIND } from "@aquarela/persistence";

import { COSTING_AUDIT_ACTIONS } from "./actions";
import type { CostingStore } from "./types";
import { assertInstantRange } from "./validation";

const FEE_KINDS: readonly string[] = FEE_KIND;
const FEE_BASES: readonly string[] = FEE_BASIS;
const PERCENTAGE_KINDS = ["commission_pct", "processing_pct"] as const;

/** Rate/percentage scale (`numeric(9,6)`, DEC-024). */
const RATE_SCALE = 6;

export interface RegisterChannelFeeRuleInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly channelId: string;
  readonly feeKind: string;
  /** Required (and null `fixedAmount`) for a percentage kind. */
  readonly percentageRate?: string | null;
  /** Required (and null `percentageRate`) for a fixed kind. */
  readonly fixedAmount?: string | null;
  readonly feeBasis: string;
  readonly taxRuleId?: string | null;
  /** ISO-8601 instant (`channel_fee_rule.effective_from` is `timestamptz`). */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface RegisterChannelFeeRuleResult {
  readonly channelFeeRuleId: string;
}

/**
 * Registers one `channel_fee_rule` (PRICE-001, `DEC-112`). Vocabulary, the
 * amount-kind consistency the DB CHECK enforces, the non-negative amounts and the
 * effective window are checked before the transaction; the channel's org scope
 * and the overlap exclusion (`channel_fee_rule_no_overlap`) run inside it as a
 * read-then-write (mirroring `registerCostPool`), so the exclusion constraint
 * stays the concurrency authority. `effective_from`/`effective_to` are
 * `timestamptz`, so the window is validated as ISO instants.
 */
export async function registerChannelFeeRule(
  store: CostingStore,
  input: RegisterChannelFeeRuleInput,
): Promise<RegisterChannelFeeRuleResult> {
  if (!FEE_KINDS.includes(input.feeKind)) {
    throw new DomainError(`feeKind must be one of ${FEE_KINDS.join(", ")}`);
  }
  if (!FEE_BASES.includes(input.feeBasis)) {
    throw new DomainError(`feeBasis must be one of ${FEE_BASES.join(", ")}`);
  }

  const percentageRate = input.percentageRate ?? null;
  const fixedAmount = input.fixedAmount ?? null;
  const isPercentage = (PERCENTAGE_KINDS as readonly string[]).includes(input.feeKind);
  if (isPercentage) {
    if (percentageRate === null) {
      throw new DomainError(`feeKind "${input.feeKind}" requires a percentageRate`);
    }
    if (fixedAmount !== null) {
      throw new DomainError(`feeKind "${input.feeKind}" must not carry a fixedAmount`);
    }
    if (parseDecimal(percentageRate, RATE_SCALE) < 0n) {
      throw new DomainError("percentageRate must not be negative");
    }
  } else {
    if (fixedAmount === null) {
      throw new DomainError(`feeKind "${input.feeKind}" requires a fixedAmount`);
    }
    if (percentageRate !== null) {
      throw new DomainError(`feeKind "${input.feeKind}" must not carry a percentageRate`);
    }
    if (parseDecimal(fixedAmount, MONEY_SCALE) < 0n) {
      throw new DomainError("fixedAmount must not be negative");
    }
  }

  assertInstantRange(input.effectiveFrom, input.effectiveTo ?? null);
  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo =
    input.effectiveTo === undefined || input.effectiveTo === null
      ? null
      : new Date(input.effectiveTo);

  return store.withTransaction(async (tx) => {
    const channel = await tx.findChannel(input.channelId);
    if (channel === undefined || channel.organizationId !== input.organizationId) {
      throw new DomainError("channel not found in organization");
    }

    // The DB exclusion `channel_fee_rule_no_overlap` scopes overlap by
    // `(channel_id, fee_kind)`, and the resolver sums several fee kinds per
    // channel, so only a same-kind window can conflict.
    const existing = await tx.listChannelFeeRulesByChannel(input.organizationId, input.channelId);
    const overlaps = existing.some(
      (rule) =>
        rule.feeKind === input.feeKind &&
        (rule.effectiveTo === null || rule.effectiveTo > effectiveFrom) &&
        (effectiveTo === null || rule.effectiveFrom < effectiveTo),
    );
    if (overlaps) {
      throw new DomainError("channel already has a fee rule overlapping this effective window");
    }

    const created = await tx.createChannelFeeRule({
      organizationId: input.organizationId,
      channelId: input.channelId,
      feeKind: input.feeKind,
      percentageRate,
      fixedAmount,
      feeBasis: input.feeBasis,
      taxRuleId: input.taxRuleId ?? null,
      effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COSTING_AUDIT_ACTIONS.channelFeeRuleRegistered,
      entityType: "channel_fee_rule",
      entityId: created.id,
      after: {
        channel_id: input.channelId,
        fee_kind: input.feeKind,
        percentage_rate: percentageRate,
        fixed_amount: fixedAmount,
        fee_basis: input.feeBasis,
        tax_rule_id: input.taxRuleId ?? null,
      },
    });

    return { channelFeeRuleId: created.id };
  });
}
