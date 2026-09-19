import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  readCookie,
  readSessionCookie,
  serializeSessionCookie,
} from "./cookies";

describe("serializeSessionCookie", () => {
  it("sets the hardening attributes and derives Max-Age from the expiry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T01:00:00.000Z");
    const cookie = serializeSessionCookie("token-value", expiresAt, now);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
  });

  it("clamps Max-Age to 0 for an already-expired session", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    const expiresAt = new Date("2026-01-01T01:00:00.000Z");
    const cookie = serializeSessionCookie("token-value", expiresAt, now);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("Max-Age=-");
  });

  it("encodes the token so it cannot break the cookie syntax", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cookie = serializeSessionCookie("a;b=c", new Date("2026-01-01T00:10:00.000Z"), now);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=a%3Bb%3Dc`);
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie immediately with the same hardening attributes", () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("readSessionCookie", () => {
  it("finds the session cookie among others", () => {
    const request = new Request("https://app.example/", {
      headers: { cookie: "theme=dark; aquarela_session=token-value; other=1" },
    });
    expect(readSessionCookie(request)).toBe("token-value");
  });

  it("returns undefined when the cookie is absent or empty", () => {
    const missing = new Request("https://app.example/", { headers: { cookie: "theme=dark" } });
    expect(readSessionCookie(missing)).toBeUndefined();
    const empty = new Request("https://app.example/", {
      headers: { cookie: "aquarela_session=" },
    });
    expect(readSessionCookie(empty)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE_NAME)).toBeUndefined();
  });
});
