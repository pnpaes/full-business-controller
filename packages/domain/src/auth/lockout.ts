import { DomainError } from "../errors";

/** One rung of the progressive-lockout ladder. */
export interface LockoutThreshold {
  /** Failure count at or above which this lock duration applies. */
  readonly afterFailures: number;
  /** Lock duration for this rung, before the policy cap is applied. */
  readonly lockMs: number;
}

/**
 * Progressive-lockout ladder plus an absolute ceiling. The schedule is data so
 * the thresholds can be tuned without touching call sites; every call to
 * `computeLockout` may pass its own policy.
 */
export interface LockoutPolicy {
  readonly thresholds: readonly LockoutThreshold[];
  /**
   * Ceiling for any single lock: it caps a rung whose duration exceeds it and
   * is the duration applied once the failure count passes the last rung.
   */
  readonly maxLockMs: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Conservative provisional defaults derived from ADR-0003, "Rate limiting and
 * progressive lockout": 5 failures -> 1 min, 6 -> 5 min, 7 -> 15 min,
 * 8 -> 60 min, capped at 24 h. These numbers are deliberately provisional and
 * tunable — the owner may confirm different values — and any caller may
 * override the policy. They map directly onto `app_user.failed_login_count`
 * and `app_user.locked_until`.
 */
export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  thresholds: [
    { afterFailures: 5, lockMs: 1 * MINUTE_MS },
    { afterFailures: 6, lockMs: 5 * MINUTE_MS },
    { afterFailures: 7, lockMs: 15 * MINUTE_MS },
    { afterFailures: 8, lockMs: 60 * MINUTE_MS },
  ],
  maxLockMs: 24 * HOUR_MS,
};

/**
 * Maps a cumulative failure count to the lock expiry. Below the first rung
 * there is no lock (`lockedUntil: null`); otherwise the highest rung whose
 * `afterFailures` is reached sets the duration, capped at `policy.maxLockMs`.
 * A count past the last rung escalates to `policy.maxLockMs`, so persistent
 * failure pins the account at the ceiling rather than looping on the top rung.
 */
export function computeLockout(
  failedLoginCount: number,
  now: Date,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): { lockedUntil: Date | null } {
  if (!Number.isInteger(failedLoginCount) || failedLoginCount < 0) {
    throw new DomainError("failed login count must be a non-negative integer");
  }

  let matched: LockoutThreshold | null = null;
  for (const threshold of policy.thresholds) {
    if (failedLoginCount < threshold.afterFailures) {
      continue;
    }
    if (matched === null || threshold.afterFailures > matched.afterFailures) {
      matched = threshold;
    }
  }

  if (matched === null) {
    return { lockedUntil: null };
  }

  // `matched` is necessarily the last rung when the count is past it, so any
  // surplus failures escalate straight to the ceiling.
  const lockMs =
    failedLoginCount > matched.afterFailures
      ? policy.maxLockMs
      : Math.min(matched.lockMs, policy.maxLockMs);
  return { lockedUntil: new Date(now.getTime() + lockMs) };
}

/** True while `lockedUntil` is strictly in the future. */
export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
