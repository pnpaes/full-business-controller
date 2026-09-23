import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  listOperatingCosts,
  registerAllocationRule,
  registerChannelFeeRule,
  registerCostPool,
  registerLaborRate,
  registerOperatingCost,
} from "@aquarela/application";
import { createDb, listEffectiveChannelFeeRules } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install a small, coherent
 * slice-6 costing data set for the Costs screens: one cost centre, one location,
 * one channel with a channel fee rule, one operating cost linked to a cost pool,
 * one labour rate, and the cost pool with its allocation rule. Everything is
 * registered through the **application** commands, so the effective-window
 * overlap rules and audit facts are exercised end-to-end.
 *
 * Run with `npx tsx apps/web/scripts/seed-costing.ts`. It never creates an
 * organization or a user: the organization must already exist (from
 * `npm run bootstrap`, whose owner is used as the acting user). Every row is
 * keyed on a deterministic code, vendor or effective window, and existence is
 * checked before registering, so a second run is a no-op.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_CODE = "DEMO_CAFE";
const CHANNEL_CODE = "DEMO_ONLINE";
const COST_CENTER_CODE = "DEMO_SHARED";
const COST_POOL_CODE = "DEMO_OVERHEAD";
const LABOR_ROLE_CODE = "kitchen";
const OPERATING_COST_VENDOR = "Demo Utilities AS";
const CHANNEL_FEE_RULE_FEE_KIND = "commission_pct";
const CHANNEL_FEE_RULE_FEE_BASIS = "net_price";
const CHANNEL_FEE_RULE_PERCENTAGE_RATE = "0.025000";
const CHANNEL_FEE_RULE_CODE = `${CHANNEL_CODE}:${CHANNEL_FEE_RULE_FEE_KIND}`;
/** A fixed effective window keeps every row reproducible across runs. */
const EFFECTIVE_FROM = "2026-01-01";

const USAGE = `Usage: npx tsx apps/web/scripts/seed-costing.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The cost centre, location, channel, channel fee rule, operating cost, labour
rate, cost pool and allocation rule are all reused when present, so re-running is
a no-op.`;

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

interface EnsureResult {
  readonly id: string;
  readonly created: boolean;
}

/** Select-then-insert-or-find by a natural key; a second run reports `created: false`. */
async function ensureRow(
  client: DbClient,
  select: { readonly text: string; readonly values: unknown[] },
  insert: { readonly text: string; readonly values: unknown[] },
): Promise<EnsureResult> {
  const existing = await client.pool.query<{ id: string }>(select.text, select.values);
  const found = existing.rows[0];
  if (found !== undefined) {
    return { id: found.id, created: false };
  }
  await client.pool.query(insert.text, insert.values);
  const created = await client.pool.query<{ id: string }>(select.text, select.values);
  const row = created.rows[0];
  if (row === undefined) {
    throw new Error("costing seed: insert did not produce a row");
  }
  return { id: row.id, created: true };
}

interface EntityLine {
  readonly kind: string;
  readonly code: string;
  readonly created: boolean;
}

interface SeedSummary {
  readonly entities: readonly EntityLine[];
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

  const entities: EntityLine[] = [];

  const location = await ensureRow(
    client,
    {
      text: "select id from location where organization_id = $1 and code = $2",
      values: [organizationId, LOCATION_CODE],
    },
    {
      text: "insert into location (organization_id, code, name, kind) values ($1, $2, $3, $4)",
      values: [organizationId, LOCATION_CODE, "Demo Café Oslo", "operating"],
    },
  );
  entities.push({ kind: "location", code: LOCATION_CODE, created: location.created });

  const channel = await ensureRow(
    client,
    {
      text: "select id from channel where organization_id = $1 and code = $2",
      values: [organizationId, CHANNEL_CODE],
    },
    {
      text: "insert into channel (organization_id, code, name, is_delivery) values ($1, $2, $3, $4)",
      values: [organizationId, CHANNEL_CODE, "Demo Online", false],
    },
  );
  entities.push({ kind: "channel", code: CHANNEL_CODE, created: channel.created });

  const costCenter = await ensureRow(
    client,
    {
      text: "select id from cost_center where organization_id = $1 and code = $2",
      values: [organizationId, COST_CENTER_CODE],
    },
    {
      text: `insert into cost_center (organization_id, code, name, kind)
        values ($1, $2, $3, $4)`,
      values: [organizationId, COST_CENTER_CODE, "Demo Shared Cost Centre", "company_shared"],
    },
  );
  entities.push({ kind: "cost centre", code: COST_CENTER_CODE, created: costCenter.created });

  const store = createPostgresCostingStore(client.db);
  const reads = createPostgresCostingReadStore(client.db);

  // Cost pool: `code` is versioned, so existence is "any version of this code".
  const poolVersions = await store.listCostPoolsByCode(organizationId, COST_POOL_CODE);
  let costPoolId: string;
  if (poolVersions.length > 0) {
    costPoolId = poolVersions[0]!.id;
    entities.push({ kind: "cost pool", code: COST_POOL_CODE, created: false });
  } else {
    const created = await registerCostPool(store, {
      organizationId,
      actorId,
      code: COST_POOL_CODE,
      name: "Demo Shared Overhead",
      effectiveFrom: EFFECTIVE_FROM,
    });
    costPoolId = created.costPoolId;
    entities.push({ kind: "cost pool", code: COST_POOL_CODE, created: true });
  }

  const effectiveRules = await store.listEffectiveAllocationRules({
    organizationId,
    asOf: new Date(`${EFFECTIVE_FROM}T00:00:00.000Z`),
    costPoolId,
  });
  if (effectiveRules.length > 0) {
    entities.push({ kind: "allocation rule", code: COST_POOL_CODE, created: false });
  } else {
    await registerAllocationRule(store, {
      organizationId,
      actorId,
      costPoolId,
      driver: "eligible_products",
      scopeType: "location",
      denominatorSource: "eligible_products",
      effectiveFrom: EFFECTIVE_FROM,
    });
    entities.push({ kind: "allocation rule", code: COST_POOL_CODE, created: true });
  }

  const existingRate = await store.findEffectiveLaborRate({
    organizationId,
    costCenterId: costCenter.id,
    roleCode: LABOR_ROLE_CODE,
    asOf: new Date(`${EFFECTIVE_FROM}T00:00:00.000Z`),
  });
  if (existingRate !== undefined) {
    entities.push({ kind: "labour rate", code: LABOR_ROLE_CODE, created: false });
  } else {
    await registerLaborRate(store, {
      organizationId,
      actorId,
      costCenterId: costCenter.id,
      roleCode: LABOR_ROLE_CODE,
      baseHourlyRate: "240",
      productiveHoursPct: "0.8500",
      effectiveFrom: EFFECTIVE_FROM,
    });
    entities.push({ kind: "labour rate", code: LABOR_ROLE_CODE, created: true });
  }

  // Operating costs have no natural key in the port, so idempotency is the
  // demo vendor + cost centre, matched through the read service.
  const existingCosts = await listOperatingCosts(reads, { organizationId });
  const existingOperatingCost = existingCosts.find(
    (cost) => cost.costCenterId === costCenter.id && cost.vendor === OPERATING_COST_VENDOR,
  );
  if (existingOperatingCost !== undefined) {
    entities.push({ kind: "operating cost", code: OPERATING_COST_VENDOR, created: false });
  } else {
    await registerOperatingCost(store, {
      organizationId,
      actorId,
      costCenterId: costCenter.id,
      locationId: location.id,
      costPoolId,
      amount: "12500",
      recurrence: "monthly",
      behavior: "fixed",
      taxBasis: "exclusive",
      effectiveFrom: EFFECTIVE_FROM,
      vendor: OPERATING_COST_VENDOR,
    });
    entities.push({ kind: "operating cost", code: OPERATING_COST_VENDOR, created: true });
  }

  // One demo channel fee rule (DEC-112). `channel_fee_rule` has no natural key in
  // the application port, so idempotency is the demo channel + fee kind matched
  // through the persistence effective-window read.
  const effectiveFeeRules = await listEffectiveChannelFeeRules(client.db, {
    organizationId,
    channelId: channel.id,
    asOf: new Date(`${EFFECTIVE_FROM}T00:00:00.000Z`),
  });
  if (effectiveFeeRules.length > 0) {
    entities.push({ kind: "channel fee rule", code: CHANNEL_FEE_RULE_CODE, created: false });
  } else {
    await registerChannelFeeRule(store, {
      organizationId,
      actorId,
      channelId: channel.id,
      feeKind: CHANNEL_FEE_RULE_FEE_KIND,
      percentageRate: CHANNEL_FEE_RULE_PERCENTAGE_RATE,
      feeBasis: CHANNEL_FEE_RULE_FEE_BASIS,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
    });
    entities.push({ kind: "channel fee rule", code: CHANNEL_FEE_RULE_CODE, created: true });
  }

  return { entities };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Costing seed complete for organization ${organizationId}.`];
  for (const entity of summary.entities) {
    lines.push(`  ${entity.kind}: ${entity.code} (${entity.created ? "created" : "exists"})`);
  }
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
  process.stderr.write(`${error instanceof Error ? error.message : "costing seed failed"}\n`);
  process.exit(1);
});
