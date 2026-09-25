import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the task mutations, applied by `withMutationGuards`
 * before the command runs. Creating a task is the rarer create (60); a
 * transition or an assignment is an amendment write (120) — the same values as
 * the workforce/document slices. The counter is the shared `DEC-135` store, so
 * every instance enforces one window; a store outage fails open.
 */
export const taskLimiters = createSharedLimiters("tasks", {
  createTask: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  transitionTask: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  assignTask: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
