import {
  createPostgresInventoryStore,
  postStockMovement,
  registerStorageArea,
} from "@aquarela/application";
import type { PostStockMovementInput } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install a small, coherent
 * inventory data set for the read surface: one unit, two stocked items, one
 * location, one storage area, and a short ledger (opening count, consumption,
 * waste) posted through the **application** `postStockMovement` command so the
 * ledger and the `stock_balance` projection are exercised end-to-end.
 *
 * Run with `npm run seed:demo`. It never creates an organization or a user: the
 * organization must already exist (from `npm run bootstrap`, whose owner is used
 * as the posting actor). Everything is keyed on deterministic codes and
 * `idempotencyKey`s, so a second run is a no-op.
 *
 * Movement source types deliberately avoid `goods_receipt`: per the `0017`
 * guard trigger a `goods_receipt` movement must reference a real accepted
 * receipt row, and the receipt-to-ledger wiring is a later slice. The opening
 * stub therefore posts as `stock_count`/`count_adjustment` (a documented
 * no-op source), consumption as `production_batch`, and waste as `waste_event`.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIT_CODE = "DEMO_G";
const LOCATION_CODE = "DEMO_CAFE";
const AREA_CODE = "DEMO_DRY";

interface ItemSpec {
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly lotTracked: boolean;
}

const ITEMS: readonly ItemSpec[] = [
  {
    code: "DEMO_ESPRESSO_BEANS",
    sku: "DEMO-SKU-ESPRESSO",
    name: "Demo Espresso Beans",
    lotTracked: true,
  },
  {
    code: "DEMO_DECAF_BEANS",
    sku: "DEMO-SKU-DECAF",
    name: "Demo Decaf Beans",
    lotTracked: false,
  },
];

const USAGE = `Usage: npm run seed:demo -- [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The organization, its owner user, the unit, items, location, storage area and
movements are all reused when present, so re-running is a no-op.`;

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
    throw new Error("demo seed: insert did not produce a row");
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
  readonly posted: number;
  readonly skipped: number;
}

interface MovementSpec {
  readonly itemId: string;
  readonly movementType: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly quantityDelta: string;
  readonly unitCost: string | null;
  readonly reasonCode: string | null;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
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

  const unit = await ensureRow(
    client,
    {
      text: "select id from unit where organization_id = $1 and code = $2",
      values: [organizationId, UNIT_CODE],
    },
    {
      text: "insert into unit (organization_id, code, dimension, is_base) values ($1, $2, $3, $4)",
      values: [organizationId, UNIT_CODE, "mass", true],
    },
  );
  entities.push({ kind: "unit", code: UNIT_CODE, created: unit.created });

  const itemIds: string[] = [];
  for (const spec of ITEMS) {
    const item = await ensureRow(
      client,
      {
        text: "select id from item where organization_id = $1 and code = $2",
        values: [organizationId, spec.code],
      },
      {
        text: `insert into item
          (organization_id, code, sku, name, item_type, base_unit_id, inventory_policy, lot_tracked)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values: [
          organizationId,
          spec.code,
          spec.sku,
          spec.name,
          "ingredient",
          unit.id,
          "stocked",
          spec.lotTracked,
        ],
      },
    );
    itemIds.push(item.id);
    entities.push({ kind: "item", code: spec.code, created: item.created });
  }

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

  const store = createPostgresInventoryStore(client.db);
  const existingArea = await store.findStorageAreaByCode({
    organizationId,
    locationId: location.id,
    code: AREA_CODE,
  });
  let storageAreaId: string;
  if (existingArea !== undefined) {
    storageAreaId = existingArea.id;
    entities.push({ kind: "storage area", code: AREA_CODE, created: false });
  } else {
    const created = await registerStorageArea(store, {
      organizationId,
      actorId,
      locationId: location.id,
      code: AREA_CODE,
      name: "Demo Dry Store",
      kind: "dry_store",
    });
    storageAreaId = created.storageAreaId;
    entities.push({ kind: "storage area", code: AREA_CODE, created: true });
  }

  // Deterministic source ids: none of these source types is guarded by the
  // `0017` trigger (only `goods_receipt` is), so a fixed synthetic uuid is safe
  // and makes the ledger rows reproducible across runs.
  const movements: readonly MovementSpec[] = [
    {
      itemId: itemIds[0]!,
      movementType: "count_adjustment",
      sourceType: "stock_count",
      sourceId: "10000000-0000-4000-8000-000000000001",
      quantityDelta: "1000.000000",
      unitCost: "0.2500",
      reasonCode: "demo opening count",
      idempotencyKey: "demo-seed-opening-espresso",
      occurredAt: "2026-09-01T08:00:00.000Z",
    },
    {
      itemId: itemIds[0]!,
      movementType: "production_consumption",
      sourceType: "production_batch",
      sourceId: "10000000-0000-4000-8000-000000000002",
      quantityDelta: "-120.000000",
      unitCost: null,
      reasonCode: null,
      idempotencyKey: "demo-seed-consumption-espresso",
      occurredAt: "2026-09-02T08:00:00.000Z",
    },
    {
      itemId: itemIds[0]!,
      movementType: "waste",
      sourceType: "waste_event",
      sourceId: "10000000-0000-4000-8000-000000000003",
      quantityDelta: "-30.000000",
      unitCost: null,
      reasonCode: "demo spoilage",
      idempotencyKey: "demo-seed-waste-espresso",
      occurredAt: "2026-09-03T08:00:00.000Z",
    },
    {
      itemId: itemIds[1]!,
      movementType: "count_adjustment",
      sourceType: "stock_count",
      sourceId: "10000000-0000-4000-8000-000000000004",
      quantityDelta: "500.000000",
      unitCost: "0.2200",
      reasonCode: "demo opening count",
      idempotencyKey: "demo-seed-opening-decaf",
      occurredAt: "2026-09-01T08:00:00.000Z",
    },
  ];

  let posted = 0;
  let skipped = 0;
  for (const movement of movements) {
    const input: PostStockMovementInput = {
      organizationId,
      actorId,
      locationId: location.id,
      storageAreaId,
      itemId: movement.itemId,
      movementType: movement.movementType,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      quantityDelta: movement.quantityDelta,
      unitCost: movement.unitCost,
      occurredAt: movement.occurredAt,
      reasonCode: movement.reasonCode,
      idempotencyKey: movement.idempotencyKey,
    };
    const result = await postStockMovement(store, input);
    if (result.replayed) {
      skipped += 1;
    } else {
      posted += 1;
    }
  }

  return { entities, posted, skipped };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Demo seed complete for organization ${organizationId}.`];
  for (const entity of summary.entities) {
    lines.push(`  ${entity.kind}: ${entity.code} (${entity.created ? "created" : "exists"})`);
  }
  lines.push(
    `  movements: ${summary.posted} posted, ${summary.skipped} already present (idempotent)`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "demo seed failed"}\n`);
  process.exit(1);
});
