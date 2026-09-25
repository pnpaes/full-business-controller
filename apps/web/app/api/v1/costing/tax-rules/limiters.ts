import { createSharedLimiters } from "../../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the tax-rule authoring mutations, applied by
 * `withMutationGuards` before the command runs. Authoring a tax rate is a
 * deliberate configuration write (30 per window, tighter than the cost-card
 * register because a rate change moves every price that resolves against it).
 * The counter is the shared `DEC-135` store; a store outage fails open.
 */
export const taxRuleLimiters = createSharedLimiters("costing.tax-rules", {
  createTaxRule: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  supersedeTaxRule: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
});
