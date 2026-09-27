import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";
import pg from "pg";

/**
 * End-to-end smoke of the *running* system (M1c). It is deliberately outside
 * the vitest suite: nothing boots the built `next start` server or drives a real
 * browser today. Run it after `db:migrate` + `npm run bootstrap` on a *fresh*
 * database and a *built* tree.
 *
 * Required env:
 *   DATABASE_URL          the migrated + bootstrapped database
 *   E2E_OWNER_PASSWORD    the password supplied to `npm run bootstrap`
 * Optional:
 *   ORGANIZATION_ID       defaults to the single `organization` row in the DB
 *   E2E_OWNER_IDENTIFIER  default `owner`
 *   PORT / E2E_BASE_URL   default `3000` / `http://localhost:PORT` (the origin
 *                         `next start` uses for the same-origin CSRF check)
 *   E2E_ARTIFACT_DIR      default `storage/tmp` (gitignored)
 *   E2E_SKIP_BOOT_SMOKE=1 skip the worker/scheduler bounded boot (they exit 0)
 *
 * It boots the web server, waits for `/api/health` (failing with the server log
 * on timeout), boots the worker and scheduler once each with both kill switches
 * off and the smoke tick mode (they exit without consuming anything), then drives
 * Chromium: sign in as the bootstrapped owner, read `/jobs`, register one manual
 * competitor source on `/insights/competitors` and assert it in the UI. A
 * screenshot is written on any failure; the created row is deleted afterwards.
 */

const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;
const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR ?? "storage/tmp";
const SCREENSHOT = path.join(ARTIFACT_DIR, "e2e-failure.png");
const IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER ?? "owner";
const PASSWORD = process.env.E2E_OWNER_PASSWORD;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SOURCE_URL = `https://e2e-${RUN_ID}.example.no/menu`;
const COMPETITOR_NAME = `E2E Cafe ${RUN_ID}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => process.stdout.write(`[e2e] ${message}\n`);

function runCommand(name, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name} timed out after ${timeoutMs}ms\n${output}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function startWebServer(env) {
  const child = spawn("npm", ["run", "start", "--workspace", "@aquarela/web"], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group: `next start` is a grandchild of npm, so the group is
    // signalled to stop it, not just the npm wrapper.
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return { child, log: () => output };
}

function stopServerGroup(child) {
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForHealth(serverLog) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body === null || body.status === "ok") return;
      }
    } catch {
      // server not up yet
    }
    await sleep(500);
  }
  throw new Error(
    `web server did not answer ${BASE}/api/health with 200 within 90s\n` +
      `--- server log ---\n${serverLog()}`,
  );
}

async function resolveOrganizationId(databaseUrl) {
  const fromEnv = process.env.ORGANIZATION_ID?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("select id from organization");
    if (rows.length !== 1) {
      throw new Error(
        `expected exactly one organization after bootstrap, found ${rows.length}; set ORGANIZATION_ID`,
      );
    }
    return rows[0].id;
  } finally {
    await client.end();
  }
}

async function deleteCreatedSource(databaseUrl, organizationId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      "delete from competitor_source where organization_id = $1 and url_or_identifier = $2",
      [organizationId, SOURCE_URL],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

async function runBrowserFlow() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  try {
    log("signing in as the bootstrapped owner");
    await page.goto("/login");
    await page.fill('input[name="identifier"]', IDENTIFIER);
    await page.fill('input[name="password"]', PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 30_000 });

    log("reading /jobs");
    await page.goto("/jobs");
    await page.getByRole("heading", { name: "Jobs", level: 1 }).waitFor({ timeout: 30_000 });

    log("registering one competitor source on /insights/competitors");
    await page.goto("/insights/competitors");
    await page.fill('input[name="competitorName"]', COMPETITOR_NAME);
    await page.fill('input[name="urlOrIdentifier"]', SOURCE_URL);
    await page.getByRole("button", { name: "Register source" }).click();
    await page.getByText("Source registered as pending terms").waitFor({ timeout: 30_000 });
    await page.getByText(SOURCE_URL, { exact: true }).waitFor({ timeout: 30_000 });
  } catch (error) {
    try {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: SCREENSHOT, fullPage: true });
      log(`failure screenshot written to ${SCREENSHOT}`);
    } catch (screenshotError) {
      log(`could not write failure screenshot: ${screenshotError?.message ?? screenshotError}`);
    }
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (PASSWORD === undefined || PASSWORD.length === 0) {
    throw new Error("E2E_OWNER_PASSWORD is required");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const organizationId = await resolveOrganizationId(databaseUrl);
  log(`organization ${organizationId}`);

  const server = startWebServer({
    DATABASE_URL: databaseUrl,
    ORGANIZATION_ID: organizationId,
    NODE_ENV: "production",
  });

  try {
    log(`waiting for ${BASE}/api/health`);
    await waitForHealth(server.log);
    log("web server healthy");

    if (process.env.E2E_SKIP_BOOT_SMOKE !== "1") {
      log("booting worker once (WORKER_TICKS=1)");
      const worker = await runCommand(
        "worker boot",
        ["run", "start", "--workspace", "@aquarela/worker"],
        { DATABASE_URL: databaseUrl, WORKER_TICKS: "1", WORKER_HEARTBEAT_MS: "1000" },
        60_000,
      );
      if (worker.code !== 0) {
        throw new Error(`worker boot exited ${worker.code}\n${worker.output}`);
      }
      log("worker booted against the schema and exited 0");

      log("booting scheduler once (SCHEDULER_TICKS=1, kill switches off)");
      const scheduler = await runCommand(
        "scheduler boot",
        ["run", "start", "--workspace", "@aquarela/scheduler"],
        {
          DATABASE_URL: databaseUrl,
          ORGANIZATION_ID: organizationId,
          SCHEDULER_TICKS: "1",
          SCHEDULER_INTERVAL_MS: "1000",
          AI_ADVISORY_ENABLED: "false",
          COMPETITOR_COLLECTION_ENABLED: "false",
        },
        60_000,
      );
      if (scheduler.code !== 0) {
        throw new Error(`scheduler boot exited ${scheduler.code}\n${scheduler.output}`);
      }
      log("scheduler booted against the schema and exited 0");
    }

    await runBrowserFlow();
    log("browser flow passed");
  } finally {
    try {
      const removed = await deleteCreatedSource(databaseUrl, organizationId);
      if (removed > 0) log(`cleaned up ${removed} competitor_source row(s)`);
    } catch (error) {
      log(`cleanup failed (non-fatal): ${error?.message ?? error}`);
    }
    stopServerGroup(server.child);
    await sleep(1000);
    try {
      if (server.child.exitCode === null) process.kill(-server.child.pid, "SIGKILL");
    } catch {
      server.child.kill("SIGKILL");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`[e2e] FAILED: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
