import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the waste record mutation, applied by
 * `withMutationGuards` before the command runs. Generous because an operator
 * records waste in bursts (§8.6); it only blunts scripted abuse. The counter is
 * the shared `DEC-135` store, so every instance enforces one window; a store
 * outage fails open.
 */
export const wasteLimiters = createSharedLimiters("waste", {
  recordWaste: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
