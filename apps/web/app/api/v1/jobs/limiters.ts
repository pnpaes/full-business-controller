import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the DLQ-review mutations, applied by
 * `withMutationGuards` before the command runs. Retry and discard are both rare,
 * deliberate operator actions, so they share one modest bound. The counter is the
 * shared `DEC-135` store, so every instance enforces one window; a store outage
 * fails open.
 */
export const jobsLimiters = createSharedLimiters("jobs", {
  retryDeadLetteredJob: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  discardDeadLetteredJob: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
});
