import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the inventory mutations, applied by `withMutationGuards`
 * before the command runs. Limits are deliberately generous (an operator posts
 * adjustments in bursts); they only blunt scripted abuse. Like every limiter in
 * this app the window is per-process — a shared store is the pre-multi-instance
 * follow-up (see the slice-8 verification debt).
 */
export const inventoryLimiters = {
  postMovement: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  reverseMovement: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  registerStorageArea: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
