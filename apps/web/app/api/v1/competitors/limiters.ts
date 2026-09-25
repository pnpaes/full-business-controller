import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the competitor mutations, applied by `withMutationGuards`
 * before the command runs. Registering a competitor and capturing an observation
 * are creates (60); the review decision is an amendment write (120) — the same
 * values as the task/workforce/document slices. The counter is the shared
 * `DEC-135` store, so every instance enforces one window; a store outage fails
 * open.
 */
export const competitorLimiters = createSharedLimiters("competitors", {
  registerCompetitor: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  recordObservation: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  reviewObservation: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
