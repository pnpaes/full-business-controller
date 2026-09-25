import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the row-12 reconciliation mutations, applied by
 * `withMutationGuards` before the command runs. Reconciling writes the
 * tolerance-snapshot fact; resolving is a cheap status transition on an existing
 * row, so it shares a looser bucket. The counter is the shared `DEC-135` store,
 * so every instance enforces one window; a store outage fails open.
 */
export const reconciliationLimiters = createSharedLimiters("reconciliations", {
  reconcile: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  resolve: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
