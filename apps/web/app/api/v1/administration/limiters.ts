import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the Administration user/access mutations, applied by
 * `withMutationGuards` before the command runs. Every action here is a security
 * change (grant, revoke, scope replace, disable, enable), so each gets its own
 * window at the same 120-per-15-minute rate as the other amendment writes. Like
 * every limiter in this app the window is per-process; a shared store is the
 * pre-multi-instance follow-up.
 */
export const administrationLimiters = {
  grantRole: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  revokeRole: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  replaceLocationScopes: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  disableUser: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  enableUser: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
