import { clientIp } from "../../../../lib/client-ip";
import { jsonError } from "../../../../lib/http";
import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the forecast-tracking surface (`DEC-138`). The `GET` read
 * is a dashboard refresh, so it gets the same generous window as the reporting
 * reads; the two mutations each get their own stricter window because they write
 * an audited fact. Counters live in the shared `DEC-135` store, so every
 * instance enforces one window, and a store outage fails open — the live role
 * gate is the control for these routes, not the throttle.
 */
export const analyticsLimiters = createSharedLimiters("analytics", {
  readForecastTracking: { limit: 600, windowMs: FIFTEEN_MINUTES_MS },
  recordForecastSnapshot: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  recordForecastOverride: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});

/**
 * Applies the tracking read throttle, returning the `429` response when the
 * caller is over the limit and `undefined` when the route may proceed. Mirrors
 * `reports/limiters.ts`: a `GET` needs no same-origin check, so this is the only
 * shared control. Async because the shared counter is a database round trip.
 */
export async function checkForecastTrackingThrottle(
  request: Request,
): Promise<Response | undefined> {
  const decision = await analyticsLimiters.readForecastTracking.check(
    clientIp(request) ?? "unknown",
  );
  if (decision.allowed) {
    return undefined;
  }
  const response = jsonError(429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
