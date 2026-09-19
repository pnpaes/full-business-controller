import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://app.example/", { headers });
}

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for and trims it", () => {
    expect(clientIp(requestWith({ "x-forwarded-for": " 203.0.113.7 , 70.41.3.18" }))).toBe(
      "203.0.113.7",
    );
  });

  it("uses x-real-ip when x-forwarded-for is absent or empty", () => {
    expect(clientIp(requestWith({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(requestWith({ "x-forwarded-for": " , ", "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
  });

  it("returns undefined when no address header is present", () => {
    expect(clientIp(requestWith({}))).toBeUndefined();
  });
});
