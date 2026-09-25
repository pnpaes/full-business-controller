import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the Administration user/access mutations, applied by
 * `withMutationGuards` before the command runs. Every action here is a security
 * change (grant, revoke, scope replace, disable, enable), so each gets its own
 * window at the same 120-per-15-minute rate as the other amendment writes. The
 * counter is the shared `DEC-135` store, so every instance enforces one window.
 * A store outage fails open — the live role gate below the throttle is the
 * control for these commands, not the throttle.
 */
export const administrationLimiters = createSharedLimiters("administration", {
  grantRole: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  revokeRole: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  replaceLocationScopes: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  disableUser: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  enableUser: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
