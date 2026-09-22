import { clientIp } from "../../../../lib/client-ip";
import { jsonError } from "../../../../lib/http";
import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the reporting reads. The reporting routes are read-only,
 * so there is no mutation limiter; the throttle still guards the on-demand
 * group-by and drill-down from a scripted client. The limit is deliberately
 * generous (a dashboard refresh is cheap and interactive). Like every limiter in
 * this app the window is per-process — a shared store is the pre-multi-instance
 * follow-up.
 */
export const reportingLimiters = {
  readSalesReport: createInMemoryRateLimiter({ limit: 600, windowMs: FIFTEEN_MINUTES_MS }),
} as const;

/**
 * Applies the read throttle to `request`, returning the `429` response when the
 * caller is over the limit and `undefined` when the route may proceed. The
 * reporting routes have no mutation guard (no same-origin check is needed for a
 * GET), so this is the only shared control.
 */
export function checkSalesReportThrottle(request: Request): Response | undefined {
  const decision = reportingLimiters.readSalesReport.check(clientIp(request) ?? "unknown");
  if (decision.allowed) {
    return undefined;
  }
  const response = jsonError(429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
