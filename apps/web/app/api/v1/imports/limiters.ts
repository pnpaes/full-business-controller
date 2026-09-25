import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the import mutations, applied by `withMutationGuards`
 * before the command runs. Registering a run and staging rows are the writes
 * that create real rows, so they get their own window; validate/map/disposition
 * are review-plane transitions and share a looser bucket. The counter is the
 * shared `DEC-135` store, so every instance enforces one window (the recorded
 * pre-multi-instance open point); a store outage fails open.
 */
export const importLimiters = createSharedLimiters("imports", {
  createRun: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  stageRows: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  review: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
