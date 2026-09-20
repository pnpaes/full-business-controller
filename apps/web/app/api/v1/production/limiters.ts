import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the production mutations, applied by `withMutationGuards`
 * before the command runs. Planning a batch and completing one are the two
 * writes that touch real work (completion posts to the append-only ledger), so
 * they get their own window; releasing/starting/cancelling a batch is a cheap
 * status transition and shares a looser bucket. Like every limiter in this app
 * the window is per-process — a shared store is the pre-multi-instance
 * follow-up.
 */
export const productionLimiters = {
  createPlan: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  createBatch: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  lifecycle: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  complete: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
