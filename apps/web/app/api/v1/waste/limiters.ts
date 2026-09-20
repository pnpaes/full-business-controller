import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the waste record mutation, applied by
 * `withMutationGuards` before the command runs. Generous because an operator
 * records waste in bursts (§8.6); it only blunts scripted abuse. Like every
 * limiter in this app the window is per-process — a shared store is the
 * pre-multi-instance follow-up.
 */
export const wasteLimiters = {
  recordWaste: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
