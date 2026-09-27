import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the AI-suggestion decisions, applied by
 * `withAiDecisionMutation` before the command runs. Approve and reject share one
 * modest bound (both are rare, deliberate operator actions). The counter is the
 * shared `DEC-135` store, so every instance enforces one window. Unlike the
 * business route limiters this one fails **closed** on a store outage (the
 * `apps/web/lib/limiters.ts` auth posture): a decision influences operations, so
 * a decision that cannot be throttled is denied rather than waved through.
 */
export const aiLimiters = createSharedLimiters(
  "ai",
  {
    decideSuggestion: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  },
  "closed",
);
