/** Name of the server-side session cookie. The value is the opaque session token. */
export const SESSION_COOKIE_NAME = "aquarela_session";

/**
 * Fixed attributes for the session cookie (ADR-0003): `HttpOnly` keeps it from
 * scripts, `Secure` keeps it off cleartext transports, `SameSite=Lax` blocks
 * cross-site POSTs, `Path=/` scopes it to the app. `Max-Age` is always derived
 * from the session's own expiry, never a fixed constant.
 */
const COOKIE_ATTRIBUTES = `Path=/; HttpOnly; Secure; SameSite=Lax`;

/**
 * Serialises the session cookie with `Max-Age` in whole seconds remaining before
 * `expiresAt`. Clamped at 0 so a stale session can never be serialised as a
 * long-lived cookie.
 */
export function serializeSessionCookie(
  token: string,
  expiresAt: Date,
  now: Date = new Date(),
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`;
}

/** Expires the session cookie immediately (logout and reset flows). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Reads one cookie value from a raw `Cookie` header, or `undefined`. */
export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = part.slice(separator + 1).trim();
    if (raw.length === 0) {
      return undefined;
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** Reads the presented session token, if any. */
export function readSessionCookie(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}
