import { createPostgresWasteStore, recordWasteEvent } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that records a couple of demo waste events across two
 * DEC-018 stages through the **application** `recordWasteEvent` command, so the
 * event, its negative `waste` ledger movement and the `stock_balance`
 * projection are exercised end-to-end.
 *
 * It reuses the demo master data created by `npm run seed:demo`
 * (`DEMO_ESPRESSO_BEANS`, `DEMO_DECAF_BEANS`, `DEMO_CAFE`, `DEMO_DRY`) and the
 * bootstrap owner as the actor; run `seed:demo` first. Each event carries a
 * deterministic `idempotencyKey`, and `recordWasteEvent` replays a known key by
 * returning the already-recorded event, so a second run is a no-op.
 *
 * Run with:
 *   npx tsx apps/web/scripts/seed-waste.ts --organization-id <uuid>
 * Values are obviously demo and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_CODE = "DEMO_CAFE";
const AREA_CODE = "DEMO_DRY";

interface WasteSpec {
  readonly itemCode: string;
  readonly quantity: string;
  readonly stage: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

/** Two stages, two demo items; `reason_code` is the stage (open point (b)). */
const WASTE_EVENTS: readonly WasteSpec[] = [
  {
    itemCode: "DEMO_ESPRESSO_BEANS",
    quantity: "12.500000",
    stage: "storage_expiry",
    occurredAt: "2026-09-10T08:00:00.000Z",
    idempotencyKey: "demo-waste-seed-espresso-storage-expiry",
  },
  {
    itemCode: "DEMO_DECAF_BEANS",
    quantity: "8.000000",
    stage: "preparation",
    occurredAt: "2026-09-11T08:00:00.000Z",
    idempotencyKey: "demo-waste-seed-decaf-preparation",
  },
];

const USAGE = `Usage: npx tsx apps/web/scripts/seed-waste.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

Requires the demo master data from \`npm run seed:demo\` (the DEMO_ items,
DEMO_CAFE location and DEMO_DRY storage area). Re-running is a no-op: each
event's deterministic idempotency key replays the recorded event.`;

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
  readonly posted: number;
  readonly skipped: number;
  readonly events: readonly string[];
}

async function lookupId(
  client: DbClient,
  text: string,
  values: readonly unknown[],
  label: string,
): Promise<string> {
  const row = await client.pool.query<{ id: string }>(text, [...values]);
  const id = row.rows[0]?.id;
  if (id === undefined) {
    return fail(`${label} not found; run \`npm run seed:demo\` first`, 2);
  }
  return id;
}

async function seed(client: DbClient, organizationId: string): Promise<SeedSummary> {
  const organization = await client.pool.query<{ id: string }>(
    "select id from organization where id = $1",
    [organizationId],
  );
  if (organization.rows[0] === undefined) {
    return fail(
      `organization ${organizationId} does not exist; run \`npm run bootstrap\` first`,
      2,
    );
  }

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

  const locationId = await lookupId(
    client,
    "select id from location where organization_id = $1 and code = $2",
    [organizationId, LOCATION_CODE],
    `location ${LOCATION_CODE}`,
  );
  const storageAreaId = await lookupId(
    client,
    "select id from storage_area where organization_id = $1 and location_id = $2 and code = $3",
    [organizationId, locationId, AREA_CODE],
    `storage area ${AREA_CODE}`,
  );

  const store = createPostgresWasteStore(client.db);
  let posted = 0;
  let skipped = 0;
  const created: string[] = [];

  for (const spec of WASTE_EVENTS) {
    const itemId = await lookupId(
      client,
      "select id from item where organization_id = $1 and code = $2",
      [organizationId, spec.itemCode],
      `item ${spec.itemCode}`,
    );

    const result = await recordWasteEvent(store, {
      organizationId,
      actorId,
      locationId,
      storageAreaId,
      itemId,
      quantity: spec.quantity,
      stage: spec.stage,
      reasonCode: spec.stage,
      occurredAt: spec.occurredAt,
      idempotencyKey: spec.idempotencyKey,
    });

    created.push(`${spec.itemCode} · ${spec.stage} · ${result.quantity} · value ${result.value}`);
    if (result.replayed) {
      skipped += 1;
    } else {
      posted += 1;
    }
  }

  return { posted, skipped, events: created };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Waste seed complete for organization ${organizationId}.`];
  for (const event of summary.events) {
    lines.push(`  event: ${event}`);
  }
  lines.push(
    `  events: ${summary.posted} recorded, ${summary.skipped} already present (idempotent)`,
  );
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
  process.stderr.write(`${error instanceof Error ? error.message : "waste seed failed"}\n`);
  process.exit(1);
});
