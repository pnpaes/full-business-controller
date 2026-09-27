#!/usr/bin/env node
// Advisory-locked migration wrapper for @aquarela/persistence.
//
// Why the lock: DigitalOcean App Platform pre-deploy jobs can overlap when a
// previous deploy is still finishing, and Spaces remote state has no Terraform
// state locking, so the single pre-deploy `db:migrate` job must not interleave
// with another migrator. A Postgres session advisory lock serialises them.
//
// `drizzle-kit push` is never used anywhere: it diffs the live database against
// the TypeScript schema and would silently drop the raw-SQL invariants (the four
// exclusion constraints, the two deferrable FKs and the six append-only
// triggers) that live only in 0002_invariants.sql. Use generate + migrate.
//
// The `pgboss` schema is owned by THIS migrator step, not by the drizzle journal:
// there is no numbered drizzle migration and no `drizzle/meta/_journal.json` entry
// for it (DEC-139 item 6, docs/adr/0004-jobs-and-outbox.md). After drizzle-kit
// migrate exits 0, still under advisory lock 8675309, this step dynamically imports
// the pinned `pg-boss` package and installs/migrates `pgboss` from the package's own
// plans, so the DDL is always derived from the pinned version at apply time and is
// never inlined or frozen here. It fails closed (non-zero exit, lock released).
//
// After provisioning, still under the same lock and on the same session, this step
// also applies the runtime grants from the migrator connection (applyPgBossGrants).
// `infra/bootstrap/pgboss-grants.sql` is entirely gated on `\if :has_pgboss`, so on
// a fresh database (schema absent) it grants nothing; the migrator then creates
// `pgboss` and the runtime role would have no USAGE/DML, so `boss.start()` ->
// `contractor.check()` fails with "permission denied for schema pgboss" and the
// worker/scheduler crash-loop. The grants are role-guarded and idempotent (see
// below), so re-running `pgboss-grants.sql` as `doadmin` is now belt-and-braces /
// recovery, not a required manual step.
//
// A pg-boss schema bump cannot be rolled back by re-deploying the previous commit:
// the older pg-boss refuses to downgrade (see the `currentVersion > expectedVersion`
// branch below) until `DROP SCHEMA pgboss CASCADE` is run.
//
// Down path (operator action; never automatic). Drop the whole schema in one
// statement: pg-boss owns every object in it, and all of its DDL is schema-qualified
// (`CREATE SCHEMA pgboss`, `pgboss.job`, `pgboss.version`, ...), so the cascade
// cannot reach the application tables in `public` — `public.job` and
// `public.outbox_event` are separate objects:
//
//     psql "$DATABASE_URL" -c 'DROP SCHEMA pgboss CASCADE;'
//
// The durable job/outbox facts are retained in `public.outbox_event`, so replaying
// unpublished outbox rows rebuilds a disposable queue (ADR-0004 shape P2).
// Rehearsal: run the drop only against a scratch database created for the purpose
// (create, migrate, confirm `pgboss` exists, drop, confirm `pgboss` gone and
// `public.job`/`public.outbox_event` untouched), never against dev or production.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

// Arbitrary but stable app-wide migration lock key. It must match any other
// migration runner that takes the same lock (CI, a future job runner, or a
// manual operator session).
const ADVISORY_LOCK_KEY = 8675309;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The schema pg-boss owns (its own default). Every pg-boss object is created
// inside it, so the down path is a single `DROP SCHEMA pgboss CASCADE`.
const PGBOSS_SCHEMA = "pgboss";

// Runtime role granted DML on `pgboss`. Defaults to the bootstrap grants file's
// `app_user` (infra/bootstrap/pgboss-grants.sql, `-v app_user=app`); override with
// PGBOSS_APP_ROLE. Local dev has a single `aquarela` role and no `app`, so the
// grants are skipped when the role is absent (see applyPgBossGrants).
const RUNTIME_ROLE = process.env.PGBOSS_APP_ROLE ?? "app";

const requireFromHere = createRequire(import.meta.url);

function logHost(label, url) {
  let host = "(unparsed)";
  try {
    host = new URL(url).host;
  } catch {
    // Never print the raw URL: it carries credentials.
  }
  console.log(`${label} host=${host}`);
}

// GRANT/ALTER DEFAULT PRIVILEGES take identifiers, not bind parameters, so quote a
// role name safely (double any embedded double quote).
function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

// pg-boss publishes the schema version its code expects in its own package.json
// (`pgboss.schema`), which `dist/contractor.js` reads when it builds a plan. Read
// it from the pinned install so the check always follows the installed package.
function expectedPgBossSchemaVersion() {
  let version;
  try {
    version = requireFromHere("pg-boss/package.json")?.pgboss?.schema;
  } catch (error) {
    throw new Error(`cannot read pg-boss package.json: ${error.message}`);
  }
  if (!Number.isInteger(version)) {
    throw new Error("pg-boss package.json carries no integer pgboss.schema");
  }
  return version;
}

// A plan runs inside its own `BEGIN; ... COMMIT;`. If it fails, the session is
// left in an aborted transaction, so clear it before reporting and re-throwing.
async function applyPgBossPlan(client, label, plan) {
  try {
    await client.query(plan);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`${label}: ${error.message ?? error.code ?? String(error)}`);
  }
}

// Provision `pgboss` from the pinned pg-boss package: construct it when the
// version table is absent, otherwise migrate only when the database is behind the
// package's expected schema version. Any error propagates to fail the deploy.
async function provisionPgBoss(client) {
  const { getConstructionPlans, getMigrationPlans } = await import("pg-boss");
  const expectedVersion = expectedPgBossSchemaVersion();

  const installed = await client.query("SELECT to_regclass($1) AS name", [
    `${PGBOSS_SCHEMA}.version`,
  ]);
  if (!installed.rows[0]?.name) {
    const plan = getConstructionPlans(PGBOSS_SCHEMA, { createSchema: true });
    await applyPgBossPlan(client, "pg-boss construction plan failed", plan);
    console.log(`migrate: provisioned ${PGBOSS_SCHEMA} schema (pg-boss ${expectedVersion})`);
    return;
  }

  const { rows } = await client.query(`SELECT version FROM ${PGBOSS_SCHEMA}.version`);
  const currentVersion = Number.parseInt(rows[0]?.version ?? "", 10);
  if (!Number.isInteger(currentVersion)) {
    throw new Error(`migrate: ${PGBOSS_SCHEMA}.version is missing or not an integer`);
  }
  if (currentVersion === expectedVersion) {
    console.log(`migrate: ${PGBOSS_SCHEMA} schema up to date (pg-boss ${currentVersion})`);
    return;
  }
  if (currentVersion > expectedVersion) {
    throw new Error(
      `migrate: ${PGBOSS_SCHEMA} schema is newer (${currentVersion}) than the ` +
        `pinned pg-boss (${expectedVersion}); refusing to downgrade. A pg-boss ` +
        `schema bump cannot be rolled back by re-deploying the previous commit ` +
        `until the schema is dropped; run: DROP SCHEMA ${PGBOSS_SCHEMA} CASCADE;`,
    );
  }
  const plan = getMigrationPlans(PGBOSS_SCHEMA, currentVersion);
  await applyPgBossPlan(
    client,
    `pg-boss migration ${currentVersion} -> ${expectedVersion} failed`,
    plan,
  );
  console.log(`migrate: migrated ${PGBOSS_SCHEMA} schema ${currentVersion} -> ${expectedVersion}`);
}

// Apply the runtime grants the operator's `pgboss-grants.sql` cannot apply on a
// fresh database (that file is gated on `\if :has_pgboss`): after the schema is
// provisioned, give the runtime role USAGE + DML on existing objects and record
// matching default privileges for objects the migrator creates later. Runs on the
// migrator session, still under the advisory lock.
//
// Every grant is guarded on the runtime role existing (pg_roles), so local dev
// (single `aquarela` role, no `app`) stays a successful no-op. A genuine grants
// failure is thrown, not swallowed: the deploy must not report green when the
// runtime cannot reach the queue, because the only other symptom is an
// unattributed worker/scheduler crash-loop (fail closed, as for provisioning).
async function applyPgBossGrants(client) {
  const role = RUNTIME_ROLE;
  const { rows: roleRows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS present",
    [role],
  );
  if (!roleRows[0]?.present) {
    console.log(`migrate: runtime role "${role}" absent; pgboss grants skipped (no-op)`);
    return;
  }
  const { rows: userRows } = await client.query("SELECT current_user AS name");
  const grantor = quoteIdent(userRows[0]?.name);
  const target = quoteIdent(role);
  const statements = [
    `GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${target};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${target};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${target};`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ${target};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${grantor} IN SCHEMA ${PGBOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${target};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${grantor} IN SCHEMA ${PGBOSS_SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO ${target};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${grantor} IN SCHEMA ${PGBOSS_SCHEMA} GRANT EXECUTE ON FUNCTIONS TO ${target};`,
  ];
  const plan = ["BEGIN;", ...statements, "COMMIT;"].join("\n");
  await applyPgBossPlan(client, `pgboss grants for runtime role "${role}" failed`, plan);
  console.log(`migrate: applied pgboss grants for runtime role "${role}"`);
}

const url = process.env.DATABASE_MIGRATIONS_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "migrate: neither DATABASE_MIGRATIONS_URL nor DATABASE_URL is set; " +
      "set DATABASE_MIGRATIONS_URL (direct/session connection) or DATABASE_URL",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
let exitCode = 1;
let lockAcquired = false;

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  lockAcquired = true;
  logHost("migrate: acquired advisory lock, running drizzle-kit migrate against", url);

  exitCode = await new Promise((resolvePromise) => {
    // Pass only what the child needs: the parent env can carry unrelated
    // secrets, and `npx`/`node` still resolve from PATH + HOME.
    const childEnv = { DATABASE_URL: url };
    for (const key of ["PATH", "HOME", "NODE_ENV", "SystemRoot", "SYSTEMROOT"]) {
      if (process.env[key] !== undefined) {
        childEnv[key] = process.env[key];
      }
    }
    const child = spawn("npx", ["--no-install", "drizzle-kit", "migrate"], {
      cwd: packageDir,
      env: childEnv,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`migrate: failed to spawn drizzle-kit: ${error.message}`);
      resolvePromise(1);
    });
    child.on("close", (code, signal) => {
      resolvePromise(code ?? (signal ? 1 : 0));
    });
  });

  // Still holding advisory lock 8675309: only after the drizzle migrations have
  // applied. A pg-boss failure here fails the deploy (fail closed).
  if (exitCode === 0) {
    await provisionPgBoss(client);
    await applyPgBossGrants(client);
  }
} catch (error) {
  // Prefer the error message, but `pg` wraps connection failures in an
  // AggregateError whose message is empty, so fall back to its code.
  const detail =
    error instanceof Error && error.message
      ? error.message
      : typeof error?.code === "string"
        ? `${error.name} (${error.code})`
        : String(error);
  console.error(`migrate: ${detail}`);
  exitCode = 1;
} finally {
  if (lockAcquired) {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch {
      // The session ends with the client; Postgres releases the lock regardless.
    }
  }
  await client.end().catch(() => undefined);
  logHost("migrate: finished against", url);
}

process.exitCode = exitCode;
