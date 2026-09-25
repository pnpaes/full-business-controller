import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the count mutations, applied by `withMutationGuards`
 * before the command runs. Counting is a burst activity (a whole area is entered
 * in one sitting), so the record limit is high; opening, approving and cancelling
 * are rare. The counter is the shared `DEC-135` store, so every instance
 * enforces one window; a store outage fails open.
 */
export const countsLimiters = createSharedLimiters("counts", {
  open: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  record: { limit: 240, windowMs: FIFTEEN_MINUTES_MS },
  approve: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  cancel: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
});
