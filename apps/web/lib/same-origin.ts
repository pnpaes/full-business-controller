import { SameOriginError } from "./errors";

export interface SameOriginSignals {
  /** The `Origin` request header, or `null` when absent. */
  readonly origin: string | null;
  /** The `Sec-Fetch-Site` request header, or `null` when absent. */
  readonly secFetchSite: string | null;
  /** The origin the request was actually delivered to. */
  readonly expectedOrigin: string;
}

/**
 * CSRF defence-in-depth alongside `SameSite=Lax`: a state-changing request must
 * either carry an `Origin` equal to the origin it reached, or (when `Origin` is
 * absent, e.g. some same-origin form posts) declare `Sec-Fetch-Site` as
 * `same-origin`/`none`. A request with neither header is rejected, so a
 * non-browser client cannot bypass the check by omitting them.
 */
export function sameOriginAllowed(signals: SameOriginSignals): boolean {
  if (signals.origin !== null && signals.origin.length > 0) {
    try {
      return new URL(signals.origin).origin === signals.expectedOrigin;
    } catch {
      // Includes the literal `Origin: null` (opaque/sandboxed origin).
      return false;
    }
  }
  return signals.secFetchSite === "same-origin" || signals.secFetchSite === "none";
}

/** Convenience wrapper that reads the signals off a request. */
export function isSameOriginRequest(request: Request): boolean {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  return sameOriginAllowed({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin,
  });
}

/** Throws `SameOriginError` unless the request is same-origin. */
export function assertSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) {
    throw new SameOriginError();
  }
}
