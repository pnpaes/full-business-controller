import { sql } from "drizzle-orm";

import type { Database } from "../client";

export interface ConsumeRateLimitInput {
  /** The limiter's stable name; keeps one policy's counter apart from another's. */
  readonly namespace: string;
  /** The caller key the limiter already uses (the client IP). */
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Test seam: the instant the hit is recorded at. Defaults to now. */
  readonly now?: Date;
}

export interface RateLimitConsumption {
  readonly allowed: boolean;
  /** Seconds until the oldest in-window hit frees a slot; `0` when allowed. */
  readonly retryAfterSeconds: number;
}

/**
 * `DEC-135`: the shared, sliding-window rate-limit counter.
 *
 * The whole decision is one statement. `INSERT … ON CONFLICT … DO UPDATE …
 * WHERE … RETURNING` takes the row lock for `(namespace, key)`, so two parallel
 * calls are serialised by Postgres: the second waits, then re-evaluates against
 * the first's committed count and cannot see the same count or admit a hit the
 * limit already rejected. When the pruned in-window count is at the limit the
 * `WHERE` suppresses the update, the statement returns no row, and the call is
 * refused; otherwise the old hits are pruned, the new hit is appended and one
 * row is returned. This mirrors `createInMemoryRateLimiter`'s sliding window
 * exactly (same `limit`, same `windowMs`, same oldest-hit `Retry-After`).
 *
 * The `Retry-After` read on the refused path is a plain read that never affects
 * admission; only the statement above decides.
 */
export async function consumeRateLimit(
  db: Database,
  input: ConsumeRateLimitInput,
): Promise<RateLimitConsumption> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.windowMs);

  const consumed = await db.execute<{ count: number }>(sql`
    INSERT INTO "rate_limit_counter" ("namespace", "key", "hits", "updated_at")
    VALUES (${input.namespace}, ${input.key}, ARRAY[${now}]::timestamptz[], ${now})
    ON CONFLICT ("namespace", "key") DO UPDATE
    SET "hits" = (
          SELECT coalesce(array_agg(h ORDER BY h), '{}'::timestamptz[])
          FROM unnest("rate_limit_counter"."hits") AS h
          WHERE h > ${cutoff}
        ) || ${now}::timestamptz,
        "updated_at" = ${now}
    WHERE (
          SELECT count(*)
          FROM unnest("rate_limit_counter"."hits") AS h
          WHERE h > ${cutoff}
        ) < ${input.limit}
    RETURNING cardinality("hits") AS "count"
  `);

  if (consumed.rows.length > 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const oldest = await db.execute<{ retryAfterSeconds: number }>(sql`
    SELECT coalesce(
      ceil(extract(epoch from (min(h) + (${input.windowMs} * interval '1 millisecond')) - ${now}::timestamptz)),
      0
    )::int AS "retryAfterSeconds"
    FROM "rate_limit_counter", unnest("hits") AS h
    WHERE "namespace" = ${input.namespace} AND "key" = ${input.key} AND h > ${cutoff}
  `);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, oldest.rows[0]?.retryAfterSeconds ?? 0),
  };
}
