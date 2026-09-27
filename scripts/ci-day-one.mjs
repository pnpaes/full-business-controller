#!/usr/bin/env node
// M1(b) — day-one bootstrap smoke (CI-runnable gate).
//
// Against a fresh database this runs the real deployment path end to end:
//   db:migrate  →  npm run bootstrap  →  SQL assertions
// and fails non-zero if any step breaks. Wired into the `verify` CI job (after
// the standalone `db:migrate` step, so the re-run here also proves the migrator
// is idempotent) and runnable locally against a throwaway database.
//
// The caller supplies a fresh `DATABASE_URL`; this script never creates or drops
// a database, so it can target the CI service database as-is. Locally the caller
// creates a throwaway database, runs this, then drops it (never the dev DB).
//
// Non-interactive by construction: `apps/web/scripts/bootstrap.ts` takes the
// organization name / owner identifier as flags or `BOOTSTRAP_*` env and the
// password only from `BOOTSTRAP_OWNER_PASSWORD` (never a flag, so it stays out
// of shell history and `ps`); it never prompts. This script passes the flags and
// sets the password env itself.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  fail("DATABASE_URL is required (point it at a fresh database)");
}

// CI-smoke defaults, all overridable. The password is not a secret: this runs
// only against a throwaway CI/scratch database. Min 12 chars (`MIN_BOOTSTRAP_PASSWORD_LENGTH`).
const ORGANIZATION_NAME = process.env.CI_DAY_ONE_ORGANIZATION_NAME ?? "Aquarela CI Day One";
const OWNER_EMAIL = process.env.CI_DAY_ONE_OWNER_EMAIL ?? "ci-owner@example.com";
const OWNER_USERNAME = process.env.CI_DAY_ONE_OWNER_USERNAME ?? "ci-owner";
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "CiDay0nePassw0rd";

/** The table set the schema test expects — parsed, never a hardcoded count. */
function expectedTableCount() {
  const source = readFileSync(here("../packages/persistence/src/schema/schema.test.ts"), "utf8");
  const start = source.indexOf("const EXPECTED_TABLES = [");
  const body = source.slice(start, source.indexOf("];", start));
  return [...body.matchAll(/"([a-z_]+)"/g)].length;
}

function fail(message) {
  process.stderr.write(`ci-day-one: ${message}\n`);
  process.exit(1);
}

/** Runs a command with inherited stdio and resolves on exit 0, rejects otherwise. */
function run(label, command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("error", (error) => reject(new Error(`${label} failed to spawn: ${error.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited ${code ?? "null"}`)),
    );
  });
}

async function main() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  // 1. Migrate (pgboss provisioning included). A re-run in CI is a no-op.
  await run("db:migrate", npm, ["run", "db:migrate"], { DATABASE_URL });

  // 2. Bootstrap the first owner, non-interactively.
  await run(
    "bootstrap",
    npm,
    [
      "run",
      "bootstrap",
      "--",
      "--organization-name",
      ORGANIZATION_NAME,
      "--owner-email",
      OWNER_EMAIL,
      "--owner-username",
      OWNER_USERNAME,
    ],
    { DATABASE_URL, BOOTSTRAP_OWNER_PASSWORD: OWNER_PASSWORD },
  );

  // 3. Assert the day-one state via SQL.
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const org = await client.query(
      "SELECT id FROM organization WHERE lower(legal_name) = lower($1)",
      [ORGANIZATION_NAME],
    );
    if (org.rows.length !== 1) {
      fail(
        `expected exactly one organization matched "${ORGANIZATION_NAME}", got ${org.rows.length}`,
      );
    }
    const organizationId = org.rows[0].id;

    const user = await client.query(
      "SELECT id FROM app_user WHERE organization_id = $1 " +
        "AND (lower(email) = lower($2) OR username = $3)",
      [organizationId, OWNER_EMAIL, OWNER_USERNAME],
    );
    if (user.rows.length !== 1) {
      fail(`expected exactly one owner user in the organization, got ${user.rows.length}`);
    }
    const userId = user.rows[0].id;

    const grant = await client.query(
      "SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id " +
        "WHERE ur.user_id = $1 AND r.organization_id = $2 AND r.code = 'owner'",
      [userId, organizationId],
    );
    if (grant.rows.length !== 1) {
      fail(`owner user ${userId} has no 'owner' role grant in the organization`);
    }

    const expected = expectedTableCount();
    const tables = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables " +
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const actual = tables.rows[0].n;
    if (actual !== expected) {
      fail(`expected ${expected} public tables (EXPECTED_TABLES in schema.test.ts), got ${actual}`);
    }

    process.stdout.write(
      "ci-day-one: OK — organization, owner user, owner grant and " +
        `${actual} public tables verified.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
