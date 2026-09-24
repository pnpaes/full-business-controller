import { clientIp } from "../../../../lib/client-ip";
import { jsonError } from "../../../../lib/http";
import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the what-if simulation. The route is read-only (it writes
 * no fact), but a scenario re-costs every baseline product through the cost
 * chain, so the limit is tighter than the reporting reads. Like every limiter in
 * this app the window is per-process — a shared store is the pre-multi-instance
 * follow-up.
 */
export const simulationLimiters = {
  runSimulation: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;

/** Applies the throttle, returning the `429` response when the caller is over it. */
export function checkSimulationThrottle(request: Request): Response | undefined {
  const decision = simulationLimiters.runSimulation.check(clientIp(request) ?? "unknown");
  if (decision.allowed) {
    return undefined;
  }
  const response = jsonError(429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
