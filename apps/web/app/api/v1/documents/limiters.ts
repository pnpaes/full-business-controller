import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the staff document library mutations, applied by
 * `withMutationGuards` before the command runs. Creating a document or a version
 * is the rarer create (60); amending a document, publishing a version and
 * acknowledging one are the amendment writes (120) — the same values as the
 * workforce slice. Like every limiter in this app the window is per-process; a
 * shared store is the pre-multi-instance follow-up.
 */
export const documentLimiters = {
  createDocument: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateDocument: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  createVersion: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  publishVersion: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  acknowledge: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
