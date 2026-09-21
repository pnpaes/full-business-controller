/**
 * Pure query parsing for the price-version read API. Kept free of Next, DB and
 * I/O imports so the route can be unit-tested directly; the route does the read.
 */

export const DEFAULT_PRICE_VERSION_LIMIT = 50;
export const MAX_PRICE_VERSION_LIMIT = 200;

export interface PriceVersionListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedPriceVersionListQuery =
  { readonly ok: true; readonly query: PriceVersionListQuery } | { readonly ok: false };

/** `undefined` = absent, `"invalid"` = present but not a non-negative integer. */
function readNonNegativeInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

/**
 * Parses `?limit`/`?offset`. A malformed pagination value is rejected rather
 * than clamped, so the caller learns the request was wrong; absent values fall
 * back to the application default page.
 */
export function parsePriceVersionListQuery(
  searchParams: URLSearchParams,
): ParsedPriceVersionListQuery {
  const limit = readNonNegativeInteger(searchParams.get("limit"));
  const offset = readNonNegativeInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_PRICE_VERSION_LIMIT)) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      limit: limit ?? DEFAULT_PRICE_VERSION_LIMIT,
      offset: offset ?? 0,
    },
  };
}
