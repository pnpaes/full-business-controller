import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the row-12 reconciliation mutations, applied by
 * `withMutationGuards` before the command runs. Reconciling writes the
 * tolerance-snapshot fact; resolving is a cheap status transition on an existing
 * row, so it shares a looser bucket. Like every limiter in this app the window
 * is per-process — a shared store is the pre-multi-instance follow-up.
 */
export const reconciliationLimiters = {
  reconcile: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  resolve: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
