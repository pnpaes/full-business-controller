import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("@aquarela/persistence", () => ({ consumeRateLimit: vi.fn() }));

import { consumeRateLimit } from "@aquarela/persistence";

import {
  createInMemoryRateLimiter,
  createSharedLimiters,
  createSharedRateLimiter,
} from "./rate-limit";

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

describe("createSharedRateLimiter (DEC-135)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates the decision to the shared store under its namespace and key", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const limiter = createSharedRateLimiter({
      namespace: "auth.login",
      limit: 10,
      windowMs: 60_000,
      failMode: "open",
    });

    await expect(limiter.check("1.2.3.4", at(0))).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 42,
    });
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.anything(), {
      namespace: "auth.login",
      key: "1.2.3.4",
      limit: 10,
      windowMs: 60_000,
      now: at(0),
    });
  });

  it("namespaces each limiter built from the same module", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const limiters = createSharedLimiters("products", {
      registerItem: { limit: 1, windowMs: 60_000 },
      registerVariant: { limit: 1, windowMs: 60_000 },
    });

    await limiters.registerItem.check("ip");
    await limiters.registerVariant.check("ip");

    expect(consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ namespace: "products.registerItem" }),
    );
    expect(consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ namespace: "products.registerVariant" }),
    );
  });

  it("fails open on a store error when configured open", async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error("store unavailable"));
    const limiter = createSharedRateLimiter({
      namespace: "products.registerItem",
      limit: 30,
      windowMs: 60_000,
      failMode: "open",
    });

    await expect(limiter.check("ip")).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("fails closed on a store error when configured closed", async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error("store unavailable"));
    const limiter = createSharedRateLimiter({
      namespace: "auth.login",
      limit: 10,
      windowMs: 90_000,
      failMode: "closed",
    });

    await expect(limiter.check("ip")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 90,
    });
  });
});
