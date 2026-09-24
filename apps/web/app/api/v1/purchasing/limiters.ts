import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the purchasing master-data mutations, applied by
 * `withMutationGuards` before the command runs. Like every limiter in this app
 * the window is per-process.
 */
export const purchasingLimiters = {
  registerSupplier: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
