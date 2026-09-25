import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the costing mutations, applied by `withMutationGuards`
 * before the command runs. Calculating a cost card is a deliberate configuration
 * write (60 per window). The counter is the shared `DEC-135` store, so every
 * instance enforces one window; a store outage fails open.
 */
export const costingLimiters = createSharedLimiters("costing", {
  calculateCostCard: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  calculatePriceScenario: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  registerChannelFeeRule: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
});
