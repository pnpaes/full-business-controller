import {
  approveStockCount,
  createPostgresCountStore,
  openStockCount,
  recordCountedLines,
} from "@aquarela/application";
import { formatDecimal, parseDecimal, QUANTITY_SCALE } from "@aquarela/domain";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install one coherent, **blind
 * capability aside** stock count: it opens a count over the demo location,
 * records a small variance per line and approves it, all **through the
 * application commands**, so the count lifecycle and the ledger posting are
 * exercised end-to-end.
 *
 * Run with `npx tsx apps/web/scripts/seed-counts.ts` (the root `seed:demo`
 * script is the sibling; this file is deliberately not wired into package.json
 * by the counts slice). It never creates an organization, user, location or
 * item: run `npm run bootstrap` and `npm run seed:demo` first. Everything is
 * keyed on a deterministic count id and a fixed cutoff, so a second run is a
 * no-op — `openStockCount` replays the existing count and, because it is already
 * approved, no line is re-recorded and no movement is re-posted.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_CODE = "DEMO_CAFE";
const ITEM_CODES = ["DEMO_ESPRESSO_BEANS", "DEMO_DECAF_BEANS"] as const;
/** Deterministic count id and cutoff: the idempotency key for the whole seed. */
const DEMO_COUNT_ID = "20000000-0000-4000-8000-000000000001";
const DEMO_CUTOFF = "2026-09-30T12:00:00.000Z";
/** Unit cost for a positive variance (the demo items have no current_cost). */
const DEMO_POSITIVE_UNIT_COST = "0.2200";

const USAGE = `Usage: npx tsx apps/web/scripts/seed-counts.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The demo location, storage area, items and count are reused when present, so
re-running is a no-op. Run \`npm run seed:demo\` first.`;

interface CliOptions {
  databaseUrl?: string;
  organizationId?: string;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
    const equals = arg.indexOf("=");
    const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    if (value === undefined || value.length === 0) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`missing value for --${key}`);
      }
      index += 1;
    }
    switch (key) {
      case "database-url":
        options.databaseUrl = value;
        break;
      case "organization-id":
        options.organizationId = value;
        break;
      default:
        throw new UsageError(`unknown option: --${key}`);
    }
  }
  return options;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

interface SeedSummary {
  readonly locationCode: string;
  readonly countId: string;
  readonly lineCount: number;
  readonly varianceCount: number;
  readonly status: string;
  readonly replayed: boolean;
}

/** `expected ± delta`, floored at zero so a demo count never sets a negative quantity. */
function adjustedCount(expected: string, delta: bigint): string {
  const base = parseDecimal(expected, QUANTITY_SCALE);
  const next = base + delta;
  return formatDecimal(next < 0n ? 0n : next, QUANTITY_SCALE);
}

async function seed(client: DbClient, organizationId: string): Promise<SeedSummary> {
  const actor = await client.pool.query<{ id: string }>(
    "select id from app_user where organization_id = $1 and status = 'active' order by id limit 1",
    [organizationId],
  );
  const actorId = actor.rows[0]?.id;
  if (actorId === undefined) {
    return fail(
      `no active app_user in organization ${organizationId}; run \`npm run bootstrap\` first`,
      2,
    );
  }

  const location = await client.pool.query<{ id: string }>(
    "select id from location where organization_id = $1 and code = $2",
    [organizationId, LOCATION_CODE],
  );
  const locationId = location.rows[0]?.id;
  if (locationId === undefined) {
    return fail(`demo location ${LOCATION_CODE} not found; run \`npm run seed:demo\` first`, 2);
  }

  // Item codes are looked up so a missing demo master data set fails loudly
  // rather than silently producing an empty count.
  for (const code of ITEM_CODES) {
    const found = await client.pool.query<{ id: string }>(
      "select id from item where organization_id = $1 and code = $2",
      [organizationId, code],
    );
    if (found.rows[0] === undefined) {
      return fail(`demo item ${code} not found; run \`npm run seed:demo\` first`, 2);
    }
  }

  const store = createPostgresCountStore(client.db);
  const opened = await openStockCount(store, {
    organizationId,
    actorId,
    locationId,
    cutoff: DEMO_CUTOFF,
    blind: false,
    stockCountId: DEMO_COUNT_ID,
  });

  if (opened.replayed) {
    const existing = await store.findStockCount({
      organizationId,
      stockCountId: DEMO_COUNT_ID,
    });
    if (existing?.status === "approved") {
      const lines = await store.listStockCountLines({
        organizationId,
        stockCountId: DEMO_COUNT_ID,
      });
      return {
        locationCode: LOCATION_CODE,
        countId: DEMO_COUNT_ID,
        lineCount: lines.length,
        varianceCount: lines.filter((line) => line.varianceQty !== null).length,
        status: existing.status,
        replayed: true,
      };
    }
  }

  // A deterministic +/-5 demo variance per line, derived from the snapshot so a
  // partially-completed first run converges instead of drifting.
  const FIVE = 5n * 1_000_000n;
  const countLines = await store.listStockCountLines({
    organizationId,
    stockCountId: opened.stockCountId,
  });
  const lines = countLines
    .filter((line) => line.countedQty === null)
    .map((line, index) => ({
      itemId: line.itemId,
      storageAreaId: line.storageAreaId,
      lotId: line.lotId,
      countedQty: adjustedCount(line.expectedQty, index % 2 === 0 ? -FIVE : FIVE),
    }));

  if (lines.length > 0) {
    await recordCountedLines(store, {
      organizationId,
      actorId,
      stockCountId: opened.stockCountId,
      lines,
    });
  }

  const approved = await approveStockCount(store, {
    organizationId,
    actorId,
    stockCountId: opened.stockCountId,
    unitCost: DEMO_POSITIVE_UNIT_COST,
    reasonCode: "demo cycle count",
  });

  return {
    locationCode: LOCATION_CODE,
    countId: opened.stockCountId,
    lineCount: lines.length,
    varianceCount: approved.varianceCount,
    status: approved.status,
    replayed: false,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Counts seed complete for organization ${organizationId}.`];
  lines.push(`  location: ${summary.locationCode} (exists)`);
  lines.push(
    `  count: ${summary.countId} (${summary.replayed ? "exists, already approved" : "opened, counted and approved"})`,
  );
  lines.push(`  lines: ${summary.lineCount} counted`);
  lines.push(`  variances: ${summary.varianceCount} posted, status ${summary.status}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof UsageError ? error.message : "invalid arguments", 1);
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const databaseUrl = firstDefined(options.databaseUrl, process.env.DATABASE_URL);
  const organizationId = firstDefined(options.organizationId, process.env.ORGANIZATION_ID);
  if (databaseUrl === undefined) {
    fail("DATABASE_URL (or --database-url) is required", 1);
  }
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    fail("DATABASE_URL must be a postgres:// or postgresql:// connection string", 1);
  }
  if (organizationId === undefined) {
    fail("ORGANIZATION_ID (or --organization-id) is required", 1);
  }
  if (!UUID.test(organizationId)) {
    fail("ORGANIZATION_ID must be a UUID", 1);
  }

  const client = createDb(databaseUrl);
  try {
    const summary = await seed(client, organizationId);
    process.stdout.write(`${renderSummary(organizationId, summary)}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  // Never echo an error that could embed a credential: only our own message.
  process.stderr.write(`${error instanceof Error ? error.message : "counts seed failed"}\n`);
  process.exit(1);
});
