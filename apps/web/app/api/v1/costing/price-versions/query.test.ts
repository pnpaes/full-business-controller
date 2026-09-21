import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRICE_VERSION_LIMIT,
  MAX_PRICE_VERSION_LIMIT,
  parsePriceVersionListQuery,
} from "./query";

describe("parsePriceVersionListQuery", () => {
  it("defaults limit and offset when absent", () => {
    expect(parsePriceVersionListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: DEFAULT_PRICE_VERSION_LIMIT, offset: 0 },
    });
  });

  it("parses explicit paging values", () => {
    expect(parsePriceVersionListQuery(new URLSearchParams("limit=10&offset=20"))).toEqual({
      ok: true,
      query: { limit: 10, offset: 20 },
    });
  });

  it("rejects malformed, zero or out-of-range limit", () => {
    expect(parsePriceVersionListQuery(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(parsePriceVersionListQuery(new URLSearchParams("limit=abc")).ok).toBe(false);
    expect(
      parsePriceVersionListQuery(new URLSearchParams(`limit=${MAX_PRICE_VERSION_LIMIT + 1}`)).ok,
    ).toBe(false);
  });

  it("rejects a malformed offset", () => {
    expect(parsePriceVersionListQuery(new URLSearchParams("offset=-1")).ok).toBe(false);
  });
});
