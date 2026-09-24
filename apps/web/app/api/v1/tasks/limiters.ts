import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the task mutations, applied by `withMutationGuards`
 * before the command runs. Creating a task is the rarer create (60); a
 * transition or an assignment is an amendment write (120) — the same values as
 * the workforce/document slices. Like every limiter in this app the window is
 * per-process; a shared store is the pre-multi-instance follow-up.
 */
export const taskLimiters = {
  createTask: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  transitionTask: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  assignTask: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
