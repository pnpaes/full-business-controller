/**
 * `jsonb` columns are inferred as `unknown`. The snapshot/scenario columns are
 * guarded by `jsonb_typeof(...) = 'object'` checks; coalescing non-objects
 * (including arrays, which `typeof` alone would accept) to `{}` keeps the
 * application record shape total without re-validating what the database owns.
 * Shared by the cost-card and price-scenario Postgres adapters so they behave
 * identically.
 */
export function asJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
