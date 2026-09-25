import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the close/lock mutations (`REC-003`, `DEC-027`), applied
 * by `withMutationGuards` before the command runs. Beginning a close is the
 * rarer write (60); locking and reopening are the amendment writes (120). The
 * counter is the shared `DEC-135` store, so every instance enforces one window;
 * a store outage fails open.
 */
export const periodCloseLimiters = createSharedLimiters("period-closes", {
  beginPeriodClose: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  lockPeriodClose: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  reopenPeriodClose: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
