import { createSharedLimiters } from "./rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the sensitive commands, applied before any auth command
 * runs. Limits are provisional and deliberately generous: the application's own
 * progressive per-account lockout is the primary brute-force control, so these
 * only blunt scripted spraying from one address.
 *
 * The counter is the shared `DEC-135` store (`rate_limit_counter`), so every
 * instance enforces one window. Unlike the business route limiters these fail
 * **closed** on a store outage: the throttle is a security control on the
 * unauthenticated surface, and a database outage already stops authentication
 * (sessions and users live in the same database), so denying is not an
 * availability regression.
 */
export const limiters = createSharedLimiters(
  "auth",
  {
    login: { limit: 10, windowMs: FIFTEEN_MINUTES_MS },
    mfa: { limit: 10, windowMs: FIFTEEN_MINUTES_MS },
    passwordResetBegin: { limit: 5, windowMs: FIFTEEN_MINUTES_MS },
    passwordResetComplete: { limit: 10, windowMs: FIFTEEN_MINUTES_MS },
    logout: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
    // MFA enrolment management (authenticated). Per-IP, so a NAT'd café is not
    // locked out by one device; the per-account lockout is not involved here
    // because the session already proves the first factor.
    mfaEnrolmentBegin: { limit: 10, windowMs: FIFTEEN_MINUTES_MS },
    mfaEnrolmentConfirm: { limit: 10, windowMs: FIFTEEN_MINUTES_MS },
    mfaRecoveryRegenerate: { limit: 5, windowMs: FIFTEEN_MINUTES_MS },
    mfaDisable: { limit: 5, windowMs: FIFTEEN_MINUTES_MS },
  },
  "closed",
);
