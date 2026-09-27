// M1(a) — automated migration-chain rehearsal.
//
// A CI-runnable gate that proves the WHOLE journaled chain is reversible:
// apply every up (via the repo's real `db:migrate` runner, so the migrator's
// pgboss provisioning is exercised too) → assert a representative schema →
// apply every `_down.sql` in reverse journal order → assert the schema is back
// to the bootstrap floor → re-apply the ups → assert again ("up → down → up").
//
// The rehearsal runs on its OWN scratch database, created and dropped through a
// `pg` client against the same server as DATABASE_URL; it never touches the dev
// database. Cleanup runs in `finally`, even on failure.
//
// Why the post-down floor is not "0 public tables": migrations `0000`–`0002` are
// bootstrap-generated (extensions, the core DDL, the hand-written invariants)
// and have **no** `_down.sql` companion — see
// `docs/runbooks/persistence-migrations.md` ("0000–0002 are bootstrap-generated
// and have no down companion"). Reversing every down therefore restores exactly
// the 35 core tables created by `0001_phase1_core.sql`; the assertion below
// derives that set from the migration file itself (never a hardcoded list) and
// asserts the residual public schema is EXACTLY it — no leftovers.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

/** Fail fast and name the file when a step breaks. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const DRIZZLE_DIR = here("../drizzle/");
const MIGRATE_SCRIPT = here("../scripts/migrate.mjs");
const SCHEMA_TEST = here("./schema/schema.test.ts");
const JOURNAL = here("../drizzle/meta/_journal.json");

/** The table set the schema test expects — parsed, never a stale hardcoded count. */
function expectedTables(): string[] {
  const source = readFileSync(SCHEMA_TEST, "utf8");
  const body = source.slice(
    source.indexOf("const EXPECTED_TABLES = ["),
    source.indexOf("];", source.indexOf("const EXPECTED_TABLES = [")),
  );
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

/** The core tables created by `0001_phase1_core.sql` (the bootstrap floor). */
function baseTables(): string[] {
  const source = readFileSync(here("../drizzle/0001_phase1_core.sql"), "utf8");
  return [...source.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((match) => match[1]!);
}

/** Every journaled up migration, in apply order (`0000` → `0078`). */
function journalTags(): string[] {
  const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => `${entry.tag}.sql`);
}

/** Every `_down.sql`, newest first (reverse journal order), paired with its up. */
function downFilesNewestFirst(): { up: string; down: string }[] {
  const downs = readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith("_down.sql"))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const ordered = new Map(journalTags().map((tag, index) => [tag, index]));
  return downs
    .map((down) => ({ up: down.replace("_down.sql", ".sql"), down }))
    .sort((a, b) => (ordered.get(b.up) ?? -1) - (ordered.get(a.up) ?? -1));
}

interface MigrateResult {
  readonly code: number;
  readonly output: string;
}

/** Runs the repo's real migrator against `url` (pgboss provisioning included). */
function runMigrate(url: string): Promise<MigrateResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [MIGRATE_SCRIPT], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

async function publicTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((row) => row.table_name);
}

async function hasPgbossSchema(client: pg.Client): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss'",
  );
  return rows.length > 0;
}

describe.skipIf(!databaseUrl)("migration chain rehearsal (up → down → up)", () => {
  const scratchName = `aquarela_chain_${process.pid}_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let scratch: pg.Client;
  let scratchUrl: string;

  const representativeSchema = async (client: pg.Client): Promise<string[]> => {
    const tables = await publicTables(client);
    const expected = [...expectedTables()].sort();
    expect(new Set(tables)).toEqual(new Set(expected));
    expect(tables).toHaveLength(expected.length);
    // A late table (0077) and a late column (0078) must be present.
    expect(tables).toContain("user_invite");
    const { rows } = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' " +
        "AND table_name = 'competitor_observation' AND column_name = 'content_hash'",
    );
    expect(rows.length).toBe(1);
    return tables;
  };

  beforeAll(async () => {
    const base = new URL(databaseUrl!);
    scratchUrl = (() => {
      base.pathname = `/${scratchName}`;
      return base.toString();
    })();
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    // Never a dev database: a dedicated scratch database on the same server.
    await admin.query(`CREATE DATABASE "${scratchName}"`);
    scratch = new pg.Client({ connectionString: scratchUrl });
    await scratch.connect();
  });

  afterAll(async () => {
    await scratch?.end().catch(() => undefined);
    if (admin) {
      // FORCE drops even a lingering connection (PostgreSQL 13+).
      await admin
        .query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("applies, reverses and re-applies the whole journaled chain", async () => {
    // --- up: the real migrator, pgboss provisioning included ---------------
    const up = await runMigrate(scratchUrl);
    expect(up.code, `db:migrate failed against ${scratchName}:\n${up.output}`).toBe(0);
    expect(await hasPgbossSchema(scratch)).toBe(true);
    const migrated = await representativeSchema(scratch);

    // --- down: every _down.sql, reverse journal order ----------------------
    const downs = downFilesNewestFirst();
    // Every journaled migration except the 0000–0002 bootstrap floor must have
    // a down companion; a future migration without one is a hard failure.
    const BOOTSTRAP = ["0000_enable_extensions.sql", "0001_phase1_core.sql", "0002_invariants.sql"];
    const covered = new Set(downs.map((entry) => entry.up));
    const uncovered = journalTags().filter((tag) => !BOOTSTRAP.includes(tag) && !covered.has(tag));
    expect(
      uncovered,
      `journaled migrations with no _down.sql companion: ${uncovered.join(", ") || "none"}`,
    ).toEqual([]);
    for (const { up: upTag, down } of downs) {
      const sql = readFileSync(`${DRIZZLE_DIR}${down}`, "utf8");
      try {
        await scratch.query(sql);
      } catch (error) {
        throw new Error(
          `down migration ${down} (reversing ${upTag}) failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // --- assert the bootstrap floor ----------------------------------------
    const floor = [...baseTables()].sort();
    const residual = (await publicTables(scratch)).sort();
    expect(
      residual,
      `after reversing ${downs.length} down migrations the public schema must be ` +
        `exactly the ${floor.length} core tables created by 0001_phase1_core.sql ` +
        `(0000–0002 have no down companion); leftover: ${
          residual.filter((name) => !floor.includes(name)).join(", ") || "none"
        }`,
    ).toEqual(floor);
    expect(residual).not.toContain("user_invite");
    // The downs touch `public` only: the migrator-owned pgboss schema stays.
    expect(await hasPgbossSchema(scratch)).toBe(true);

    // --- up again: destructive bootstrap reset, then the real migrator -----
    await scratch.query(
      "DROP SCHEMA IF EXISTS public CASCADE; " +
        "DROP SCHEMA IF EXISTS drizzle CASCADE; " +
        "DROP SCHEMA IF EXISTS pgboss CASCADE; " +
        "CREATE SCHEMA public;",
    );
    const upAgain = await runMigrate(scratchUrl);
    expect(upAgain.code, `db:migrate (re-apply) failed:\n${upAgain.output}`).toBe(0);
    const reapplied = await representativeSchema(scratch);
    expect(reapplied).toEqual(migrated);
  }, 600_000);
});
