import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the HMS mutations, applied by `withMutationGuards` before
 * the command runs. Registering a point, an incident or a checklist template is
 * the rare configuration write (60); recording a reading, a corrective action or
 * a checklist run, and the status-driven updates, are the frequent operational
 * ones (120). Like every limiter in this app the window is per-process — a shared
 * store is the pre-multi-instance follow-up.
 */
export const hmsLimiters = {
  registerPoint: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  recordReading: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  registerIncident: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateIncident: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  recordCorrectiveAction: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  updateCorrectiveAction: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  registerChecklistTemplate: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateChecklistTemplate: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  recordChecklistRun: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  updateChecklistRun: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
