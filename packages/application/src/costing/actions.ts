/**
 * Audit action vocabulary for operating costs + labour + allocation. Values are
 * the `audit_event.action` strings; keeping them here stops a handler from
 * drifting into near-duplicate names.
 */
export const COSTING_AUDIT_ACTIONS = {
  laborRateRegistered: "costing.labor_rate.registered",
  operatingCostRegistered: "costing.operating_cost.registered",
  costPoolRegistered: "costing.cost_pool.registered",
  allocationRuleRegistered: "costing.allocation_rule.registered",
} as const;
