/**
 * Audit action vocabulary for tax-rule authoring. Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names.
 */
export const TAX_AUDIT_ACTIONS = {
  taxRuleCreated: "tax.tax_rule.created",
  taxRuleSuperseded: "tax.tax_rule.superseded",
} as const;
