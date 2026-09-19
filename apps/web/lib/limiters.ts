import { createInMemoryRateLimiter } from "./rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the sensitive commands, applied before any auth command
 * runs. Limits are provisional and deliberately generous: the application's own
 * progressive per-account lockout is the primary brute-force control, so these
 * only blunt scripted spraying from one address.
 */
export const limiters = {
  login: createInMemoryRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
  mfa: createInMemoryRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
  passwordResetBegin: createInMemoryRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES_MS }),
  passwordResetComplete: createInMemoryRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
  logout: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
