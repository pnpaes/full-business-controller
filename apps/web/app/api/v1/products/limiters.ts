import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the product-catalog mutations, applied by
 * `withMutationGuards` before the command runs. Master data changes are rare
 * compared with operational posts, so the limits are tight; they only blunt
 * scripted abuse. Like every limiter in this app the window is per-process.
 */
export const productLimiters = {
  registerItem: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  registerSupplierItem: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
