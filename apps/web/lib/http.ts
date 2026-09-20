import { ConfigError } from "@aquarela/config";
import { AUTH_ERROR_GENERIC, DomainError } from "@aquarela/domain";

import { AuthHttpError } from "./errors";

/**
 * Every authentication failure returns the one generic message (ADR-0003), so a
 * caller cannot tell which part of a credential was wrong or whether an account
 * exists. Status codes differ (400 malformed, 401 rejected, 403 cross-origin,
 * 429 throttled, 500/503 server fault) but the body never does.
 *
 * A caller may override the message for a `DomainError`: those messages are
 * authored in the domain layer (for example a duplicate import hash or an
 * illegal state transition), never derived from a driver or internal error, so
 * they are safe to return verbatim. The generic auth message remains the
 * default, and no driver/internal error text is ever surfaced.
 */
export function jsonError(status: number, message: string = AUTH_ERROR_GENERIC): Response {
  return Response.json({ error: message }, { status });
}

/** Success envelope; `setCookies` are appended verbatim as `Set-Cookie` headers. */
export function jsonOk(
  body: Record<string, unknown> = {},
  setCookies: readonly string[] = [],
): Response {
  const response = Response.json({ ok: true, ...body });
  for (const cookie of setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

/**
 * Runs a handler and maps any thrown error to the generic response. Errors are
 * deliberately not logged here: a driver error can embed parameters (a token or
 * hash), and the application layer already writes an audit row for every
 * security outcome, so the request path stays silent.
 */
export async function mapErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(400, error.message);
    }
    if (error instanceof AuthHttpError) {
      return jsonError(error.status);
    }
    if (error instanceof ConfigError) {
      return jsonError(503);
    }
    return jsonError(500);
  }
}
