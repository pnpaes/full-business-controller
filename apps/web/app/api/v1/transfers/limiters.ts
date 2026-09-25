import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the transfer mutations, applied by `withMutationGuards`
 * before the command runs. Limits are deliberately generous (an operator posts
 * transfers in bursts); they only blunt scripted abuse. The counter is the
 * shared `DEC-135` store, so every instance enforces one window; a store outage
 * fails open.
 */
export const transferLimiters = createSharedLimiters("transfers", {
  createTransfer: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  approveTransfer: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  dispatchTransfer: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  receiveTransfer: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  cancelTransfer: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
});
