import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the competitor mutations, applied by `withMutationGuards`
 * before the command runs. Registering a competitor and capturing an observation
 * are creates (60); the review decision is an amendment write (120) — the same
 * values as the task/workforce/document slices. Like every limiter in this app
 * the window is per-process; a shared store is the pre-multi-instance follow-up.
 */
export const competitorLimiters = {
  registerCompetitor: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  recordObservation: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  reviewObservation: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
