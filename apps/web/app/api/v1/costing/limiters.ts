import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the costing mutations, applied by `withMutationGuards`
 * before the command runs. Calculating a cost card is a deliberate configuration
 * write (60 per window). Like every limiter in this app the window is
 * per-process — a shared store is the pre-multi-instance follow-up.
 */
export const costingLimiters = {
  calculateCostCard: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
