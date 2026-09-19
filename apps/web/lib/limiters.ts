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
  // MFA enrolment management (authenticated). Per-IP, so a NAT'd café is not
  // locked out by one device; the per-account lockout is not involved here
  // because the session already proves the first factor.
  mfaEnrolmentBegin: createInMemoryRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
  mfaEnrolmentConfirm: createInMemoryRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
  mfaRecoveryRegenerate: createInMemoryRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES_MS }),
  mfaDisable: createInMemoryRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
