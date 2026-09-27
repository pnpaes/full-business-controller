import { readFileSync } from "node:fs";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { listWorkerHeartbeats, upsertWorkerHeartbeat } from "./worker-heartbeat";

const databaseUrl = process.env.DATABASE_URL;

/** Rebuilds a connection URL for another database on the same server. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * `DEC-139` item 8 runs against a scratch database created and dropped here, not
 * the shared dev database. The scratch database is built by executing the real
 * `0073` migration file, so the DDL under test is the shipped one.
 */
describe.skipIf(!databaseUrl)("worker heartbeat repository", () => {
  const databaseName = `aquarela_whb_test_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let client: DbClient;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: withDatabase(databaseUrl!, "postgres") });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    client = createDb(withDatabase(databaseUrl!, databaseName));

    const migration = readFileSync(
      new URL("../../drizzle/0073_worker_heartbeat.sql", import.meta.url),
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

  it("inserts a heartbeat and reads it back", async () => {
    const seenAt = new Date("2026-09-27T08:00:00.000Z");
    await upsertWorkerHeartbeat(client.db, {
      workerId: "worker:host:1",
      role: "worker",
      seenAt,
    });

    const rows = await listWorkerHeartbeats(client.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workerId: "worker:host:1", role: "worker" });
    expect(rows[0]?.lastSeenAt.toISOString()).toBe(seenAt.toISOString());
  });

  it("updates the same row on re-upsert instead of inserting a second", async () => {
    await upsertWorkerHeartbeat(client.db, {
      workerId: "worker:host:2",
      role: "worker",
      seenAt: new Date("2026-09-27T09:00:00.000Z"),
    });
    const later = new Date("2026-09-27T09:00:30.000Z");
    await upsertWorkerHeartbeat(client.db, {
      workerId: "worker:host:2",
      role: "scheduler",
      seenAt: later,
    });

    const rows = await listWorkerHeartbeats(client.db);
    const matching = rows.filter((row) => row.workerId === "worker:host:2");
    expect(matching).toHaveLength(1);
    expect(matching[0]?.role).toBe("scheduler");
    expect(matching[0]?.lastSeenAt.toISOString()).toBe(later.toISOString());
  });

  it("lists heartbeats newest last_seen_at first", async () => {
    await upsertWorkerHeartbeat(client.db, {
      workerId: "worker:order:old",
      role: "worker",
      seenAt: new Date("2026-09-27T10:00:00.000Z"),
    });
    await upsertWorkerHeartbeat(client.db, {
      workerId: "worker:order:new",
      role: "worker",
      seenAt: new Date("2026-09-27T10:05:00.000Z"),
    });

    const rows = await listWorkerHeartbeats(client.db);
    const orderIds = rows.map((row) => row.workerId);
    expect(orderIds.indexOf("worker:order:new")).toBeLessThan(orderIds.indexOf("worker:order:old"));
  });

  it("rejects a role outside the allow-list", async () => {
    await expect(
      client.pool.query(
        "INSERT INTO worker_heartbeat (worker_id, role, last_seen_at) VALUES ($1, $2, now())",
        ["worker:bad", "manager"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
