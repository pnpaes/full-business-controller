import { createPostgresReceivingStore, recordGoodsReceipt } from "@aquarela/application";
import { QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install a coherent receiving
 * data set for the Purchasing screens: one supplier with two packs, and one
 * accepted goods receipt with two lines recorded through the **application**
 * `recordGoodsReceipt` command, so the landed-cost computation, the
 * effective-dated price history and the audit fact are exercised end-to-end.
 *
 * Run with
 * `DATABASE_URL=… ORGANIZATION_ID=… npx tsx apps/web/scripts/seed-receiving.ts`.
 * It never creates an organization or a user: the organization must already
 * exist (from `npm run bootstrap`, whose owner acts as the accepting user).
 *
 * Idempotency: the location, unit, item, supplier and supplier packs are keyed
 * on deterministic codes and reused when present; the receipt is detected by its
 * `delivery_ref` (`DEMO-RECV-1`) before the command runs, so re-running neither
 * duplicates the receipt nor closes/duplicates the price history it appended.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_CODE = "DEMO_CAFE";
const BASE_UNIT_CODE = "DEMO_G";
const PACK_UNIT_CODE = "DEMO_PACK";
const SUPPLIER_CODE = "DEMO_SUPPLIER";
const DELIVERY_REF = "DEMO-RECV-1";
/** A fixed instant keeps the receipt and its price windows reproducible. */
const RECEIVED_AT = new Date("2026-09-15T09:00:00.000Z");

interface PackSpec {
  readonly itemCode: string;
  readonly sku: string;
  readonly itemName: string;
  readonly supplierSku: string;
  readonly packToBaseUnitFactor: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly price: string;
  readonly lotNumber: string;
  readonly expiryDate: string;
}

const PACKS: readonly PackSpec[] = [
  {
    itemCode: "DEMO_ESPRESSO_BEANS",
    sku: "DEMO-SKU-ESPRESSO",
    itemName: "Demo Espresso Beans",
    supplierSku: "DEMO-ESP-1KG",
    packToBaseUnitFactor: "1000",
    receivedPackQty: "4",
    acceptedPackQty: "3.5",
    price: "180",
    lotNumber: "DEMO-LOT-ESP-1",
    expiryDate: "2027-03-31",
  },
  {
    itemCode: "DEMO_DECAF_BEANS",
    sku: "DEMO-SKU-DECAF",
    itemName: "Demo Decaf Beans",
    supplierSku: "DEMO-DEC-1KG",
    packToBaseUnitFactor: "1000",
    receivedPackQty: "3",
    acceptedPackQty: "3",
    price: "165",
    lotNumber: "DEMO-LOT-DEC-1",
    expiryDate: "2027-02-28",
  },
];

const USAGE = `Usage: npx tsx apps/web/scripts/seed-receiving.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The location, unit, item, supplier, supplier packs and the demo receipt are all
reused when present, so re-running is a no-op.`;

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

/** The rejected pack quantity is the received/accepted shortfall (accepted ≤ received). */
function rejectedPackQty(spec: PackSpec): string {
  return formatDecimal(
    parseDecimal(spec.receivedPackQty, QUANTITY_SCALE) -
      parseDecimal(spec.acceptedPackQty, QUANTITY_SCALE),
    QUANTITY_SCALE,
  );
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
    throw new Error("receiving seed: insert did not produce a row");
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
  readonly receipt: { readonly id: string; readonly created: boolean };
  readonly lineCount: number;
}

async function seed(client: DbClient, organizationId: string): Promise<SeedSummary> {
  const organization = await client.pool.query<{ id: string; currency: string }>(
    "select id, currency from organization where id = $1",
    [organizationId],
  );
  const org = organization.rows[0];
  if (org === undefined) {
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

  const baseUnit = await ensureRow(
    client,
    {
      text: "select id from unit where organization_id = $1 and code = $2",
      values: [organizationId, BASE_UNIT_CODE],
    },
    {
      text: "insert into unit (organization_id, code, dimension, is_base) values ($1, $2, $3, $4)",
      values: [organizationId, BASE_UNIT_CODE, "mass", true],
    },
  );
  entities.push({ kind: "base unit", code: BASE_UNIT_CODE, created: baseUnit.created });

  const packUnit = await ensureRow(
    client,
    {
      text: "select id from unit where organization_id = $1 and code = $2",
      values: [organizationId, PACK_UNIT_CODE],
    },
    {
      text: "insert into unit (organization_id, code, dimension, is_base) values ($1, $2, $3, $4)",
      values: [organizationId, PACK_UNIT_CODE, "package", false],
    },
  );
  entities.push({ kind: "pack unit", code: PACK_UNIT_CODE, created: packUnit.created });

  const supplier = await ensureRow(
    client,
    {
      text: "select id from supplier where organization_id = $1 and code = $2",
      values: [organizationId, SUPPLIER_CODE],
    },
    {
      text: "insert into supplier (organization_id, code, name, currency) values ($1, $2, $3, $4)",
      values: [organizationId, SUPPLIER_CODE, "Demo Supplier AS", org.currency],
    },
  );
  entities.push({ kind: "supplier", code: SUPPLIER_CODE, created: supplier.created });

  const receiptLineInputs: Array<{
    readonly supplierItemId: string;
    readonly itemId: string;
    readonly spec: PackSpec;
  }> = [];

  for (const spec of PACKS) {
    const item = await ensureRow(
      client,
      {
        text: "select id from item where organization_id = $1 and code = $2",
        values: [organizationId, spec.itemCode],
      },
      {
        text: `insert into item
          (organization_id, code, sku, name, item_type, base_unit_id, inventory_policy)
          values ($1, $2, $3, $4, $5, $6, $7)`,
        values: [
          organizationId,
          spec.itemCode,
          spec.sku,
          spec.itemName,
          "ingredient",
          baseUnit.id,
          "stocked",
        ],
      },
    );
    entities.push({ kind: "item", code: spec.itemCode, created: item.created });

    const supplierItem = await ensureRow(
      client,
      {
        text: "select id from supplier_item where supplier_id = $1 and supplier_sku = $2",
        values: [supplier.id, spec.supplierSku],
      },
      {
        text: `insert into supplier_item
          (organization_id, supplier_id, item_id, supplier_sku, pack_unit_id, pack_to_base_unit_factor)
          values ($1, $2, $3, $4, $5, $6)`,
        values: [
          organizationId,
          supplier.id,
          item.id,
          spec.supplierSku,
          packUnit.id,
          spec.packToBaseUnitFactor,
        ],
      },
    );
    entities.push({ kind: "supplier pack", code: spec.supplierSku, created: supplierItem.created });
    receiptLineInputs.push({ supplierItemId: supplierItem.id, itemId: item.id, spec });
  }

  const existingReceipt = await client.pool.query<{ id: string }>(
    "select id from goods_receipt where organization_id = $1 and delivery_ref = $2",
    [organizationId, DELIVERY_REF],
  );
  const foundReceipt = existingReceipt.rows[0];
  if (foundReceipt !== undefined) {
    const lines = await client.pool.query<{ n: number }>(
      "select count(*)::int as n from goods_receipt_line where goods_receipt_id = $1",
      [foundReceipt.id],
    );
    return {
      entities,
      receipt: { id: foundReceipt.id, created: false },
      lineCount: lines.rows[0]?.n ?? 0,
    };
  }

  const store = createPostgresReceivingStore(client.db);
  const result = await recordGoodsReceipt(store, {
    organizationId,
    locationId: location.id,
    actorId,
    receivedAt: RECEIVED_AT,
    supplierId: supplier.id,
    deliveryRef: DELIVERY_REF,
    lines: receiptLineInputs.map(({ supplierItemId, itemId, spec }) => ({
      supplierItemId,
      itemId,
      unitId: packUnit.id,
      packToBaseFactor: spec.packToBaseUnitFactor,
      receivedPackQty: spec.receivedPackQty,
      acceptedPackQty: spec.acceptedPackQty,
      rejectedPackQty: rejectedPackQty(spec),
      price: spec.price,
      taxBasis: "exclusive",
      lotNumber: spec.lotNumber,
      expiryDate: spec.expiryDate,
    })),
  });

  return {
    entities,
    receipt: { id: result.goodsReceiptId, created: true },
    lineCount: result.lines.length,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Receiving seed complete for organization ${organizationId}.`];
  for (const entity of summary.entities) {
    lines.push(`  ${entity.kind}: ${entity.code} (${entity.created ? "created" : "exists"})`);
  }
  lines.push(
    `  goods receipt: ${DELIVERY_REF} (${summary.receipt.created ? "created" : "exists"})${
      summary.receipt.created ? ` id ${summary.receipt.id}` : ""
    }, ${summary.lineCount} ${summary.lineCount === 1 ? "line" : "lines"}`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "receiving seed failed"}\n`);
  process.exit(1);
});
