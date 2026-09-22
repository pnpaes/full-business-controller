import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the close/lock mutations (`REC-003`, `DEC-027`), applied
 * by `withMutationGuards` before the command runs. Beginning a close is the
 * rarer write (60); locking and reopening are the amendment writes (120). Like
 * every limiter in this app the window is per-process — a shared store is the
 * pre-multi-instance follow-up.
 */
export const periodCloseLimiters = {
  beginPeriodClose: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  lockPeriodClose: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  reopenPeriodClose: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
