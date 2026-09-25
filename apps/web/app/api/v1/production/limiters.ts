import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the production mutations, applied by `withMutationGuards`
 * before the command runs. Planning a batch and completing one are the two
 * writes that touch real work (completion posts to the append-only ledger), so
 * they get their own window; releasing/starting/cancelling a batch is a cheap
 * status transition and shares a looser bucket. The counter is the shared
 * `DEC-135` store, so every instance enforces one window; a store outage fails
 * open.
 */
export const productionLimiters = createSharedLimiters("production", {
  createPlan: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  createBatch: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  lifecycle: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  complete: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
});
