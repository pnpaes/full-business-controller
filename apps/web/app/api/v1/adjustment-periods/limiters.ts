import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the adjustment-period mutations (`REC-006`, `DEC-027`),
 * applied by `withMutationGuards` before the command runs. Opening a correction
 * window is the rarer write (60); closing it is the follow-up write (120). The
 * counter is the shared `DEC-135` store, so every instance enforces one window.
 * A store outage fails open — this is a mutation throttle, not an auth gate.
 */
export const adjustmentPeriodLimiters = createSharedLimiters("adjustment-periods", {
  openAdjustmentPeriod: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  closeAdjustmentPeriod: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
