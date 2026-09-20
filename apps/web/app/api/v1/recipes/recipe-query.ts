/**
 * Pure query parsing for the recipe read APIs. Kept free of Next, DB and I/O
 * imports so it can be unit-tested directly; the routes do the reads.
 */

import { DEFAULT_RECIPE_LIST_LIMIT, MAX_RECIPE_LIST_LIMIT } from "@aquarela/application";

export interface RecipeListQuery {
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface RecipeDetailQuery {
  /** Cost-preview as-of instant. */
  readonly asOf: Date;
}

export type ParsedRecipeListQuery =
  { readonly ok: true; readonly query: RecipeListQuery } | { readonly ok: false };

export type ParsedRecipeDetailQuery =
  { readonly ok: true; readonly query: RecipeDetailQuery } | { readonly ok: false };

/** Bounds the search term so a pathological query string cannot reach the DB. */
const MAX_SEARCH_LENGTH = 200;

/** `undefined` = absent, `"invalid"` = present but not a non-negative integer. */
function readInteger(
  searchParams: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  const parsed = Number.parseInt(value, 10);
  return parsed >= min && parsed <= max ? parsed : "invalid";
}

/**
 * Parses `?search`, `?limit` and `?offset`. A blank search is treated as absent;
 * a present-but-malformed pagination value is rejected rather than clamped, so
 * the caller learns the request was wrong.
 */
export function parseRecipeListQuery(searchParams: URLSearchParams): ParsedRecipeListQuery {
  const limit = readInteger(searchParams, "limit", 1, MAX_RECIPE_LIST_LIMIT);
  const offset = readInteger(searchParams, "offset", 0, Number.MAX_SAFE_INTEGER);
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }

  const rawSearch = searchParams.get("search");
  if (rawSearch !== null && rawSearch.trim().length > MAX_SEARCH_LENGTH) {
    return { ok: false };
  }
  const search = rawSearch?.trim();

  return {
    ok: true,
    query: {
      ...(search === undefined || search.length === 0 ? {} : { search }),
      limit: limit ?? DEFAULT_RECIPE_LIST_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/**
 * Parses `?asOf` (an ISO-8601 instant), defaulting to `now`. The application's
 * cost read validates the instant semantically; this only rejects a value that is
 * not a parseable date, so a malformed cutoff never reaches the store.
 */
export function parseRecipeDetailQuery(
  searchParams: URLSearchParams,
  now: Date = new Date(),
): ParsedRecipeDetailQuery {
  const raw = searchParams.get("asOf");
  if (raw === null) {
    return { ok: true, query: { asOf: now } };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  return { ok: true, query: { asOf: parsed } };
}
