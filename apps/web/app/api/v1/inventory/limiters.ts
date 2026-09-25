import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the inventory mutations, applied by `withMutationGuards`
 * before the command runs. Limits are deliberately generous (an operator posts
 * adjustments in bursts); they only blunt scripted abuse. The counter is the
 * shared `DEC-135` store, so every instance enforces one window (the slice-8
 * pre-multi-instance verification debt); a store outage fails open.
 */
export const inventoryLimiters = createSharedLimiters("inventory", {
  postMovement: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  reverseMovement: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  registerStorageArea: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
});
