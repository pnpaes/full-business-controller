/**
 * HTTP-boundary errors. Route handlers translate these into the single generic
 * auth response; the cause is never echoed to the client or written to logs.
 */

/** A failure that already carries the HTTP status the route should return. */
export class AuthHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("auth request failed");
    this.name = "AuthHttpError";
    this.status = status;
  }
}

/** Thrown by `assertSameOrigin` when a state-changing request is not same-origin. */
export class SameOriginError extends Error {
  constructor() {
    super("request is not same-origin");
    this.name = "SameOriginError";
  }
}
