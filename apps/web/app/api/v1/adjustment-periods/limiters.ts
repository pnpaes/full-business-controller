import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the adjustment-period mutations (`REC-006`, `DEC-027`),
 * applied by `withMutationGuards` before the command runs. Opening a correction
 * window is the rarer write (60); closing it is the follow-up write (120). Like
 * every limiter in this app the window is per-process — a shared store is the
 * pre-multi-instance follow-up.
 */
export const adjustmentPeriodLimiters = {
  openAdjustmentPeriod: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  closeAdjustmentPeriod: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
