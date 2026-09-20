import {
  approveStockTransfer,
  createPostgresInventoryStore,
  createPostgresTransferStore,
  dispatchStockTransfer,
  postStockMovement,
  receiveStockTransfer,
  registerStorageArea,
  requestStockTransfer,
} from "@aquarela/application";
import type { PostStockMovementInput } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install a coherent **transfer**
 * data set: a second operating location, its storage area, a virtual transit
 * location with its in-transit area, a stocked demo item, and one transfer moved
 * through the real application commands (`requestStockTransfer` →
 * `approveStockTransfer` → `dispatchStockTransfer` → `receiveStockTransfer`) so
 * the paired source→transit→destination legs and the header lifecycle are
 * exercised end-to-end.
 *
 * Run with `npm run seed:transfers`. It never creates an organization or a user:
 * the organization must already exist (from `npm run bootstrap`). Everything is
 * keyed on deterministic codes and a fixed transfer id, so a second run resumes
 * an in-progress demo transfer or reports it as already received — never a
 * duplicate. No secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIT_CODE = "DEMO_G";
const ITEM_CODE = "DEMO_TRANSFER_FLOUR";
const ITEM_SKU = "DEMO-SKU-TRANSFER-FLOUR";
const FROM_LOCATION_CODE = "DEMO_CAFE";
const TO_LOCATION_CODE = "DEMO_CAFE_2";
const TRANSIT_LOCATION_CODE = "DEMO_TRANSIT";
const FROM_AREA_CODE = "DEMO_DRY";
const TO_AREA_CODE = "DEMO_DRY_2";
const TRANSIT_AREA_CODE = "DEMO_TRANSIT_AREA";

/** Fixed so a re-run finds the same header instead of requesting a new one. */
const DEMO_TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const DISPATCH_QUANTITY = "250.000000";

const USAGE = `Usage: npm run seed:transfers -- [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The second location, transit point, item and transfer are reused when present,
and the demo transfer resumes from its current status, so re-running is a no-op.`;

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
    throw new Error("transfer seed: insert did not produce a row");
  }
  return { id: row.id, created: true };
}

interface SeedSummary {
  readonly entities: readonly {
    readonly kind: string;
    readonly code: string;
    readonly created: boolean;
  }[];
  readonly transferStatus: string;
  readonly resumed: boolean;
  readonly posted: number;
  readonly replayed: number;
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
  // Capture the narrowed value so closures below see a definite `string`.
  const actorUserId: string = actorId;

  const entities: SeedSummary["entities"][number][] = [];
  const inventory = createPostgresInventoryStore(client.db);
  const transfers = createPostgresTransferStore(client.db);

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

  const item = await ensureRow(
    client,
    {
      text: "select id from item where organization_id = $1 and code = $2",
      values: [organizationId, ITEM_CODE],
    },
    {
      text: `insert into item
        (organization_id, code, sku, name, item_type, base_unit_id, inventory_policy, lot_tracked)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [
        organizationId,
        ITEM_CODE,
        ITEM_SKU,
        "Demo Transfer Flour",
        "ingredient",
        unit.id,
        "stocked",
        false,
      ],
    },
  );
  entities.push({ kind: "item", code: ITEM_CODE, created: item.created });

  const fromLocation = await ensureRow(
    client,
    {
      text: "select id from location where organization_id = $1 and code = $2",
      values: [organizationId, FROM_LOCATION_CODE],
    },
    {
      text: "insert into location (organization_id, code, name, kind) values ($1, $2, $3, $4)",
      values: [organizationId, FROM_LOCATION_CODE, "Demo Café Oslo", "operating"],
    },
  );
  entities.push({ kind: "location", code: FROM_LOCATION_CODE, created: fromLocation.created });

  const toLocation = await ensureRow(
    client,
    {
      text: "select id from location where organization_id = $1 and code = $2",
      values: [organizationId, TO_LOCATION_CODE],
    },
    {
      text: "insert into location (organization_id, code, name, kind) values ($1, $2, $3, $4)",
      values: [organizationId, TO_LOCATION_CODE, "Demo Café Bergen", "operating"],
    },
  );
  entities.push({ kind: "location", code: TO_LOCATION_CODE, created: toLocation.created });

  const transitLocation = await ensureRow(
    client,
    {
      text: "select id from location where organization_id = $1 and code = $2",
      values: [organizationId, TRANSIT_LOCATION_CODE],
    },
    {
      text: "insert into location (organization_id, code, name, kind) values ($1, $2, $3, $4)",
      values: [organizationId, TRANSIT_LOCATION_CODE, "Demo In Transit", "virtual_transit"],
    },
  );
  entities.push({
    kind: "location",
    code: TRANSIT_LOCATION_CODE,
    created: transitLocation.created,
  });

  async function ensureArea(
    locationId: string,
    code: string,
    name: string,
    isTransit: boolean,
  ): Promise<string> {
    const existing = await inventory.findStorageAreaByCode({ organizationId, locationId, code });
    if (existing !== undefined) {
      entities.push({ kind: "storage area", code, created: false });
      return existing.id;
    }
    const created = await registerStorageArea(inventory, {
      organizationId,
      actorId: actorUserId,
      locationId,
      code,
      name,
      kind: isTransit ? "transit" : "dry_store",
      isTransit,
    });
    entities.push({ kind: "storage area", code, created: true });
    return created.storageAreaId;
  }

  const fromAreaId = await ensureArea(fromLocation.id, FROM_AREA_CODE, "Demo Dry Store", false);
  const toAreaId = await ensureArea(toLocation.id, TO_AREA_CODE, "Demo Dry Store 2", false);
  await ensureArea(transitLocation.id, TRANSIT_AREA_CODE, "Demo In Transit", true);

  // Opening stock at the source. `adjustment` is a documented no-op source type
  // for the 0020 guard; the fixed idempotency key makes a re-run a replay.
  const opening: PostStockMovementInput = {
    organizationId,
    actorId,
    locationId: fromLocation.id,
    storageAreaId: fromAreaId,
    itemId: item.id,
    movementType: "count_adjustment",
    sourceType: "adjustment",
    sourceId: "20000000-0000-4000-8000-000000000001",
    quantityDelta: "1000.000000",
    unitCost: "0.2500",
    occurredAt: "2026-09-01T08:00:00.000Z",
    reasonCode: "demo opening count",
    idempotencyKey: "seed-transfers-opening",
  };
  const openingResult = await postStockMovement(inventory, opening);
  let posted = openingResult.replayed ? 0 : 1;
  const replayed = openingResult.replayed ? 1 : 0;

  // Request the fixed demo transfer only when it does not exist yet.
  let transfer = await transfers.findStockTransfer({
    organizationId,
    transferId: DEMO_TRANSFER_ID,
  });
  const resumed = transfer !== undefined;
  if (transfer === undefined) {
    await requestStockTransfer(transfers, {
      organizationId,
      actorId: actorUserId,
      fromLocationId: fromLocation.id,
      fromStorageAreaId: fromAreaId,
      toLocationId: toLocation.id,
      toStorageAreaId: toAreaId,
      transferId: DEMO_TRANSFER_ID,
    });
    transfer = await transfers.findStockTransfer({
      organizationId,
      transferId: DEMO_TRANSFER_ID,
    });
  }

  // Resume from whatever status the transfer is in, so a partial first run heals.
  if (transfer?.status === "requested") {
    await approveStockTransfer(transfers, {
      organizationId,
      actorId: actorUserId,
      transferId: DEMO_TRANSFER_ID,
    });
  }
  transfer = await transfers.findStockTransfer({ organizationId, transferId: DEMO_TRANSFER_ID });
  if (transfer?.status === "approved") {
    await dispatchStockTransfer(transfers, {
      organizationId,
      actorId: actorUserId,
      transferId: DEMO_TRANSFER_ID,
      lines: [{ itemId: item.id, quantity: DISPATCH_QUANTITY }],
      occurredAt: "2026-09-02T08:00:00.000Z",
    });
    posted += 2;
  }
  transfer = await transfers.findStockTransfer({ organizationId, transferId: DEMO_TRANSFER_ID });
  if (transfer?.status === "dispatched") {
    await receiveStockTransfer(transfers, {
      organizationId,
      actorId: actorUserId,
      transferId: DEMO_TRANSFER_ID,
      received: [{ itemId: item.id, quantity: DISPATCH_QUANTITY }],
      occurredAt: "2026-09-03T08:00:00.000Z",
    });
    posted += 2;
  }
  transfer = await transfers.findStockTransfer({ organizationId, transferId: DEMO_TRANSFER_ID });

  return {
    entities,
    transferStatus: transfer?.status ?? "missing",
    resumed,
    posted,
    replayed,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Transfer seed complete for organization ${organizationId}.`];
  for (const entity of summary.entities) {
    lines.push(`  ${entity.kind}: ${entity.code} (${entity.created ? "created" : "exists"})`);
  }
  lines.push(
    `  transfer ${DEMO_TRANSFER_ID}: ${summary.transferStatus} (${
      summary.resumed ? "resumed" : "created"
    })`,
  );
  lines.push(
    `  ledger movements: ${summary.posted} posted, ${summary.replayed} already present (idempotent)`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "transfer seed failed"}\n`);
  process.exit(1);
});
