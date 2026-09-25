import { clientIp } from "./client-ip";
import { jsonError, mapErrors } from "./http";
import type { RateLimiter } from "./rate-limit";
import { assertSameOrigin } from "./same-origin";

/**
 * The controls every mutating auth route must apply, in order: same-origin check
 * first (cheap, rejects CSRF), then the per-IP throttle, then the handler. All
 * thrown errors become the generic response via `mapErrors`.
 */
export async function withMutationGuards(
  request: Request,
  limiter: RateLimiter,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    assertSameOrigin(request);
  } catch {
    return jsonError(403);
  }

  const decision = await limiter.check(clientIp(request) ?? "unknown");
  if (!decision.allowed) {
    const response = jsonError(429);
    response.headers.set("Retry-After", String(decision.retryAfterSeconds));
    return response;
  }

  return mapErrors(run);
}
