import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the import mutations, applied by `withMutationGuards`
 * before the command runs. Registering a run and staging rows are the writes
 * that create real rows, so they get their own window; validate/map/disposition
 * are review-plane transitions and share a looser bucket. Like every limiter in
 * this app the window is per-process — a shared store is the pre-multi-instance
 * follow-up (recorded open point).
 */
export const importLimiters = {
  createRun: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  stageRows: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  review: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
