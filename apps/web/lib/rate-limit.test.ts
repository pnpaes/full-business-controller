import { describe, expect, it } from "vitest";

import { createInMemoryRateLimiter } from "./rate-limit";

const start = new Date("2026-01-01T00:00:00.000Z");
const at = (offsetMs: number): Date => new Date(start.getTime() + offsetMs);

describe("createInMemoryRateLimiter", () => {
  it("allows calls up to the limit and blocks the next one", () => {
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check("ip", at(0)).allowed).toBe(true);
    expect(limiter.check("ip", at(1_000)).allowed).toBe(true);
    expect(limiter.check("ip", at(2_000)).allowed).toBe(true);
    const blocked = limiter.check("ip", at(3_000));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("frees the window once the oldest hit expires", () => {
    const limiter = createInMemoryRateLimiter({ limit: 2, windowMs: 10_000 });
    expect(limiter.check("ip", at(0)).allowed).toBe(true);
    expect(limiter.check("ip", at(5_000)).allowed).toBe(true);
    expect(limiter.check("ip", at(9_000)).allowed).toBe(false);
    // The hit at 0 is now outside the window; the one at 5_000 is still inside.
    expect(limiter.check("ip", at(10_001)).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check("a", at(0)).allowed).toBe(true);
    expect(limiter.check("a", at(1)).allowed).toBe(false);
    expect(limiter.check("b", at(1)).allowed).toBe(true);
  });
});
