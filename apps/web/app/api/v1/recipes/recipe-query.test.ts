import { describe, expect, it } from "vitest";

import { parseRecipeDetailQuery, parseRecipeListQuery } from "./recipe-query";

describe("parseRecipeListQuery", () => {
  it("defaults limit and offset and omits an absent search", () => {
    expect(parseRecipeListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("accepts search, limit and offset", () => {
    expect(
      parseRecipeListQuery(new URLSearchParams({ search: "sauce", limit: "10", offset: "5" })),
    ).toEqual({ ok: true, query: { search: "sauce", limit: 10, offset: 5 } });
  });

  it("treats a blank search as absent", () => {
    expect(parseRecipeListQuery(new URLSearchParams({ search: "   " }))).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("rejects malformed pagination", () => {
    expect(parseRecipeListQuery(new URLSearchParams({ limit: "0" }))).toEqual({ ok: false });
    expect(parseRecipeListQuery(new URLSearchParams({ limit: "many" }))).toEqual({ ok: false });
    expect(parseRecipeListQuery(new URLSearchParams({ offset: "-1" }))).toEqual({ ok: false });
  });

  it("rejects an oversized search term", () => {
    expect(parseRecipeListQuery(new URLSearchParams({ search: "x".repeat(201) }))).toEqual({
      ok: false,
    });
  });
});

describe("parseRecipeDetailQuery", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("defaults asOf to now", () => {
    expect(parseRecipeDetailQuery(new URLSearchParams(), now)).toEqual({
      ok: true,
      query: { asOf: now },
    });
  });

  it("accepts an explicit instant", () => {
    const result = parseRecipeDetailQuery(
      new URLSearchParams({ asOf: "2026-06-01T00:00:00.000Z" }),
      now,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query.asOf.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("rejects a blank or unparseable instant", () => {
    expect(parseRecipeDetailQuery(new URLSearchParams({ asOf: "  " }), now)).toEqual({ ok: false });
    expect(parseRecipeDetailQuery(new URLSearchParams({ asOf: "not-a-date" }), now)).toEqual({
      ok: false,
    });
  });
});
