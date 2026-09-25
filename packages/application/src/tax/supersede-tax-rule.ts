import { DomainError } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";
import { TAX_AUDIT_ACTIONS } from "./actions";
import type { TaxWriteStore } from "./write-types";

export interface SupersedeTaxRuleInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly taxRuleId: string;
  /** ISO-8601 instant at which the rule stops being effective (`[from, to)`). */
  readonly effectiveTo: string;
}

export interface SupersedeTaxRuleResult {
  readonly taxRuleId: string;
  readonly effectiveTo: string;
}

/**
 * Ends one effective-dated `tax_rule` by setting its `effective_to`, so a new
 * rule can take over from that instant (`DEC-003`/`DEC-022`/`DEC-045`).
 *
 * This is the **only** mutation a rule may receive. Rate, basis, recoverable
 * flag, applicability and scope are never editable: financial facts are
 * append-only (`DEC-008`/`DEC-028`), so a rate change is a new rule effective
 * from a date. A rule that already carries an `effective_to` is refused rather
 * than re-ended, because re-writing an end date would silently rewrite history.
 * The instant must be strictly after the rule's own `effective_from` (the DB's
 * `tax_rule_effective_range_check`); a cross-organization id is refused.
 */
export async function supersedeTaxRule(
  store: TaxWriteStore,
  input: SupersedeTaxRuleInput,
): Promise<SupersedeTaxRuleResult> {
  if (input.taxRuleId.trim().length === 0) {
    throw new DomainError("taxRuleId must not be empty");
  }
  assertIsoInstant(input.effectiveTo, "effectiveTo");
  const effectiveTo = new Date(input.effectiveTo);

  return store.withTransaction(async (tx) => {
    const rule = await tx.findTaxRuleById(input.taxRuleId);
    if (rule === undefined || rule.organizationId !== input.organizationId) {
      throw new DomainError("tax rule not found in organization");
    }
    if (rule.effectiveTo !== null) {
      throw new DomainError(
        `tax rule "${rule.code}" already ended at ${rule.effectiveTo.toISOString()}; a rate change is a new rule effective from a date, not a rewritten end date`,
      );
    }
    if (effectiveTo.getTime() <= rule.effectiveFrom.getTime()) {
      throw new DomainError(
        `effectiveTo must be after the rule's effectiveFrom (${rule.effectiveFrom.toISOString()})`,
      );
    }

    const ended = await tx.endTaxRule(input.organizationId, input.taxRuleId, effectiveTo);
    if (ended === undefined) {
      throw new DomainError("tax rule not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TAX_AUDIT_ACTIONS.taxRuleSuperseded,
      entityType: "tax_rule",
      entityId: ended.id,
      before: { effective_to: null },
      after: { effective_to: effectiveTo.toISOString() },
    });

    return { taxRuleId: ended.id, effectiveTo: effectiveTo.toISOString() };
  });
}
