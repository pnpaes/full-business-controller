import { describe, expect, it } from "vitest";

import { SameOriginError } from "./errors";
import { assertSameOrigin, isSameOriginRequest } from "./same-origin";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://app.example/api/v1/auth/login", { headers });
}

describe("isSameOriginRequest", () => {
  it("allows a matching Origin", () => {
    expect(isSameOriginRequest(requestWith({ origin: "https://app.example" }))).toBe(true);
  });

  it("denies a cross-site Origin", () => {
    expect(isSameOriginRequest(requestWith({ origin: "https://evil.example" }))).toBe(false);
  });

  it("denies the opaque Origin: null", () => {
    expect(isSameOriginRequest(requestWith({ origin: "null" }))).toBe(false);
  });

  it("allows a missing Origin only when Sec-Fetch-Site is same-origin or none", () => {
    expect(isSameOriginRequest(requestWith({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(requestWith({ "sec-fetch-site": "none" }))).toBe(true);
    expect(isSameOriginRequest(requestWith({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("fails closed when neither Origin nor Sec-Fetch-Site is present", () => {
    expect(isSameOriginRequest(requestWith({}))).toBe(false);
  });
});

describe("assertSameOrigin", () => {
  it("throws SameOriginError for a cross-site request", () => {
    expect(() => assertSameOrigin(requestWith({ origin: "https://evil.example" }))).toThrow(
      SameOriginError,
    );
  });

  it("does not throw for a same-origin request", () => {
    expect(() => assertSameOrigin(requestWith({ origin: "https://app.example" }))).not.toThrow();
  });
});
