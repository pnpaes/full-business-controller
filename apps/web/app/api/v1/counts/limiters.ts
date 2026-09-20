import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the count mutations, applied by `withMutationGuards`
 * before the command runs. Counting is a burst activity (a whole area is entered
 * in one sitting), so the record limit is high; opening, approving and cancelling
 * are rare. Like every limiter in this app the window is per-process — a shared
 * store is the pre-multi-instance follow-up.
 */
export const countsLimiters = {
  open: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  record: createInMemoryRateLimiter({ limit: 240, windowMs: FIFTEEN_MINUTES_MS }),
  approve: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  cancel: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
