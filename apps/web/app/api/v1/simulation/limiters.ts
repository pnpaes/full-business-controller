import { clientIp } from "../../../../lib/client-ip";
import { jsonError } from "../../../../lib/http";
import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttle for the what-if simulation. The route is read-only (it writes
 * no fact), but a scenario re-costs every baseline product through the cost
 * chain, so the limit is tighter than the reporting reads. The counter is the
 * shared `DEC-135` store, so every instance enforces one window; a store outage
 * fails open.
 */
export const simulationLimiters = createSharedLimiters("simulation", {
  runSimulation: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});

/**
 * Applies the throttle, returning the `429` response when the caller is over it.
 * Async because the shared counter is a database round trip.
 */
export async function checkSimulationThrottle(request: Request): Promise<Response | undefined> {
  const decision = await simulationLimiters.runSimulation.check(clientIp(request) ?? "unknown");
  if (decision.allowed) {
    return undefined;
  }
  const response = jsonError(429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
