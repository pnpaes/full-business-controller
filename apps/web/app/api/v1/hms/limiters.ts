import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the HMS monitoring mutations, applied by
 * `withMutationGuards` before the command runs. Registering a point is a rare
 * configuration write; recording a reading is the frequent operational one, so
 * it gets the looser bucket. Like every limiter in this app the window is
 * per-process — a shared store is the pre-multi-instance follow-up.
 */
export const hmsLimiters = {
  registerPoint: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  recordReading: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
