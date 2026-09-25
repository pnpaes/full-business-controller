import { clientIp } from "../../../../lib/client-ip";
import { jsonError } from "../../../../lib/http";
import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the reporting reads. The reporting routes are read-only,
 * so there is no mutation limiter; the throttle still guards the on-demand
 * group-by and drill-down from a scripted client. The limit is deliberately
 * generous (a dashboard refresh is cheap and interactive). The counter is the
 * shared `DEC-135` store, so every instance enforces one window; a store outage
 * fails open, because a read throttle must not take the dashboard down.
 */
export const reportingLimiters = createSharedLimiters("reports", {
  readSalesReport: { limit: 600, windowMs: FIFTEEN_MINUTES_MS },
});

/**
 * Applies the read throttle to `request`, returning the `429` response when the
 * caller is over the limit and `undefined` when the route may proceed. The
 * reporting routes have no mutation guard (no same-origin check is needed for a
 * GET), so this is the only shared control. Async because the shared counter is
 * a database round trip.
 */
export async function checkSalesReportThrottle(request: Request): Promise<Response | undefined> {
  const decision = await reportingLimiters.readSalesReport.check(clientIp(request) ?? "unknown");
  if (decision.allowed) {
    return undefined;
  }
  const response = jsonError(429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
