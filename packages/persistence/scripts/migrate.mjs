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
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

// Arbitrary but stable app-wide migration lock key. It must match any other
// migration runner that takes the same lock (CI, a future job runner, or a
// manual operator session).
const ADVISORY_LOCK_KEY = 8675309;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function logHost(label, url) {
  let host = "(unparsed)";
  try {
    host = new URL(url).host;
  } catch {
    // Never print the raw URL: it carries credentials.
  }
  console.log(`${label} host=${host}`);
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
