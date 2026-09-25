import { readFileSync } from "node:fs";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { consumeRateLimit } from "./rate-limit";

const databaseUrl = process.env.DATABASE_URL;

const start = new Date("2026-09-25T08:00:00.000Z");
const at = (offsetMs: number): Date => new Date(start.getTime() + offsetMs);

/** Rebuilds a connection URL for another database on the same server. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * `DEC-135` runs against a scratch database created and dropped here, not the
 * shared dev database: these tests exercise the counter directly and cannot all
 * run inside a rolled-back transaction (the concurrency case must commit for a
 * second connection to observe the first). The scratch database is built by
 * executing the real migration file, so the DDL under test is the shipped one.
 */
describe.skipIf(!databaseUrl)("rate limit counter repository", () => {
  const databaseName = `aquarela_rl_test_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let client: DbClient;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: withDatabase(databaseUrl!, "postgres") });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    client = createDb(withDatabase(databaseUrl!, databaseName));

    const migration = readFileSync(
      new URL("../../drizzle/0067_rate_limit_counter.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await client.pool.query(trimmed);
      }
    }
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  it("allows up to the limit and refuses the next hit without recording it", async () => {
    const namespace = "test.limit";
    const key = "allow-then-block";
    const options = { namespace, key, limit: 2, windowMs: 60_000 };

    expect((await consumeRateLimit(client.db, { ...options, now: start })).allowed).toBe(true);
    expect((await consumeRateLimit(client.db, { ...options, now: at(1_000) })).allowed).toBe(true);

    const blocked = await consumeRateLimit(client.db, { ...options, now: at(2_000) });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // The refused call appended nothing: the window still holds exactly two hits.
    expect((await consumeRateLimit(client.db, { ...options, now: at(3_000) })).allowed).toBe(false);
  });

  it("frees the window once the oldest hit expires", async () => {
    const namespace = "test.window";
    const key = "expiry";
    const options = { namespace, key, limit: 2, windowMs: 10_000 };

    expect((await consumeRateLimit(client.db, { ...options, now: start })).allowed).toBe(true);
    expect((await consumeRateLimit(client.db, { ...options, now: at(5_000) })).allowed).toBe(true);
    expect((await consumeRateLimit(client.db, { ...options, now: at(9_000) })).allowed).toBe(false);
    // The hit at 0 is now outside the window; the one at 5_000 is still inside.
    expect((await consumeRateLimit(client.db, { ...options, now: at(10_001) })).allowed).toBe(true);
  });

  it("tracks namespaces and keys independently", async () => {
    const options = { limit: 1, windowMs: 60_000, now: start };
    const first = await consumeRateLimit(client.db, {
      ...options,
      namespace: "test.a",
      key: "same",
    });
    const otherKey = await consumeRateLimit(client.db, {
      ...options,
      namespace: "test.a",
      key: "other",
    });
    const otherNamespace = await consumeRateLimit(client.db, {
      ...options,
      namespace: "test.b",
      key: "same",
    });

    expect([first.allowed, otherKey.allowed, otherNamespace.allowed]).toEqual([true, true, true]);
  });

  it("admits exactly one of two parallel hits at the limit (atomic increment)", async () => {
    const namespace = "test.concurrent";
    const key = "race";
    const options = { namespace, key, limit: 1, windowMs: 60_000, now: start };

    const results = await Promise.all([
      consumeRateLimit(client.db, options),
      consumeRateLimit(client.db, options),
    ]);

    // Two parallel calls cannot both read the same count: the row lock makes one
    // of them re-evaluate after the other commits and refuse.
    expect(results.map((row) => row.allowed).sort()).toEqual([false, true]);
  });
});
