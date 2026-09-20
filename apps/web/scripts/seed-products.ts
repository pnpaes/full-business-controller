import {
  createPostgresMasterDataStore,
  registerItem,
  registerSupplierItem,
  registerUnit,
} from "@aquarela/application";
import { createDb, createSupplier, findSupplierByCode } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install a small, coherent
 * **catalog** data set for the Products screens: a unit pair, four items across
 * item types and inventory policies, a supplier and one supplier pack per item.
 * Everything is created through the **application** commands
 * (`registerUnit`/`registerItem`/`registerSupplierItem`), which are idempotent on
 * their natural keys, so a second run reports the rows as existing instead of
 * duplicating them.
 *
 * Run with `npx tsx apps/web/scripts/seed-products.ts`. It never creates an
 * organization or a user: the organization must already exist (from
 * `npm run bootstrap`). The codes are deliberately `PROD_*`, disjoint from
 * `seed-demo.ts`'s `DEMO_*` items, so running both seeds leaves two independent
 * demo sets.
 *
 * No secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_UNIT_CODE = "PROD_G";
const PACK_UNIT_CODE = "PROD_PACK";
const SUPPLIER_CODE = "PROD_SUPPLIER";
const PACK_FACTOR = "1000";

interface ItemSpec {
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
  readonly supplierSku: string;
  readonly preferred: boolean;
}

const ITEMS: readonly ItemSpec[] = [
  {
    code: "PROD_COFFEE_BEANS",
    sku: "PROD-SKU-COFFEE-BEANS",
    name: "Demo Coffee Beans",
    itemType: "ingredient",
    inventoryPolicy: "stocked",
    lotTracked: true,
    supplierSku: "PROD-COFFEE-BEANS-1KG",
    preferred: true,
  },
  {
    code: "PROD_OAT_MILK",
    sku: "PROD-SKU-OAT-MILK",
    name: "Demo Oat Milk",
    itemType: "ingredient",
    inventoryPolicy: "stocked",
    lotTracked: true,
    supplierSku: "PROD-OAT-MILK-1L",
    preferred: true,
  },
  {
    code: "PROD_CUP_12OZ",
    sku: "PROD-SKU-CUP-12OZ",
    name: "Demo Cup 12oz",
    itemType: "packaging",
    inventoryPolicy: "stocked",
    lotTracked: false,
    supplierSku: "PROD-CUP-12OZ-50",
    preferred: false,
  },
  {
    code: "PROD_MACHINE_CLEANER",
    sku: "PROD-SKU-MACHINE-CLEANER",
    name: "Demo Machine Cleaner",
    itemType: "non_stock_supply",
    inventoryPolicy: "non_stock",
    lotTracked: false,
    supplierSku: "PROD-CLEANER-5L",
    preferred: false,
  },
];

const USAGE = `Usage: npx tsx apps/web/scripts/seed-products.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

Units, items, the supplier and its supplier packs are all reused when present,
so re-running is a no-op. Codes are PROD_* and never collide with seed:demo.`;

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

interface EntityLine {
  readonly kind: string;
  readonly code: string;
  readonly created: boolean;
}

interface SeedSummary {
  readonly entities: readonly EntityLine[];
}

/** Find-or-create the demo supplier by its organization-scoped code. */
async function ensureSupplier(
  client: DbClient,
  organizationId: string,
): Promise<{ readonly id: string; readonly created: boolean }> {
  const existing = await findSupplierByCode(client.db, organizationId, SUPPLIER_CODE);
  if (existing !== undefined) {
    return { id: existing.id, created: false };
  }
  const created = await createSupplier(client.db, {
    organizationId,
    code: SUPPLIER_CODE,
    name: "Demo Products Supplier",
  });
  return { id: created.id, created: true };
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

  const store = createPostgresMasterDataStore(client.db);
  const entities: EntityLine[] = [];

  const baseUnit = await registerUnit(store, {
    organizationId,
    code: BASE_UNIT_CODE,
    dimension: "mass",
    isBase: true,
  });
  entities.push({ kind: "unit", code: BASE_UNIT_CODE, created: baseUnit.created });

  const packUnit = await registerUnit(store, {
    organizationId,
    code: PACK_UNIT_CODE,
    dimension: "package",
    isBase: false,
  });
  entities.push({ kind: "unit", code: PACK_UNIT_CODE, created: packUnit.created });

  const supplier = await ensureSupplier(client, organizationId);
  entities.push({ kind: "supplier", code: SUPPLIER_CODE, created: supplier.created });

  for (const spec of ITEMS) {
    const item = await registerItem(store, {
      organizationId,
      code: spec.code,
      sku: spec.sku,
      name: spec.name,
      itemType: spec.itemType,
      baseUnitId: baseUnit.unitId,
      inventoryPolicy: spec.inventoryPolicy,
      lotTracked: spec.lotTracked,
    });
    entities.push({ kind: "item", code: spec.code, created: item.created });

    // `registerSupplierItem` rejects a duplicate SKU by design, so the seed
    // checks the natural key first to stay idempotent across runs.
    const existingPack = await store.findSupplierItemBySku(supplier.id, spec.supplierSku);
    if (existingPack !== undefined) {
      entities.push({ kind: "supplier pack", code: spec.supplierSku, created: false });
      continue;
    }
    await registerSupplierItem(store, {
      organizationId,
      supplierId: supplier.id,
      itemId: item.itemId,
      supplierSku: spec.supplierSku,
      packUnitId: packUnit.unitId,
      packToBaseUnitFactor: PACK_FACTOR,
      minOrderQty: "1",
      leadTimeDays: 2,
      preferred: spec.preferred,
    });
    entities.push({ kind: "supplier pack", code: spec.supplierSku, created: true });
  }

  return { entities };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Product seed complete for organization ${organizationId}.`];
  for (const entity of summary.entities) {
    lines.push(`  ${entity.kind}: ${entity.code} (${entity.created ? "created" : "exists"})`);
  }
  lines.push(
    "  supplier packs are idempotent on (supplier, supplier SKU): a second run keeps the first.",
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
  process.stderr.write(`${error instanceof Error ? error.message : "product seed failed"}\n`);
  process.exit(1);
});
