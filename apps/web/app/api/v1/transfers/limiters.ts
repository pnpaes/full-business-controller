import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the transfer mutations, applied by `withMutationGuards`
 * before the command runs. Limits are deliberately generous (an operator posts
 * transfers in bursts); they only blunt scripted abuse. Like every limiter in
 * this app the window is per-process — a shared store is the pre-multi-instance
 * follow-up.
 */
export const transferLimiters = {
  createTransfer: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  approveTransfer: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  dispatchTransfer: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  receiveTransfer: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  cancelTransfer: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
