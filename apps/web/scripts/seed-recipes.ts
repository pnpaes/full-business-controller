import {
  createPostgresRecipeStore,
  registerRecipe,
  registerRecipeVersion,
} from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install one coherent recipe for
 * the recipe read surface: a recipe identity, an approved version and its nested
 * lines, registered through the **application** commands so version derivation,
 * unit compatibility and the audit trail are exercised end-to-end.
 *
 * Run with `npx tsx apps/web/scripts/seed-recipes.ts`. It never creates an
 * organization, user, unit or item: those come from `npm run seed:demo`
 * (`DEMO_G`, `DEMO_ESPRESSO_BEANS`, `DEMO_DECAF_BEANS`) and `npm run bootstrap`
 * (the owner used as the registration actor). Everything is keyed on the
 * deterministic recipe code and version number, so a second run is a no-op.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIT_CODE = "DEMO_G";
const RECIPE_CODE = "DEMO_HOUSE_BLEND";
const RECIPE_NAME = "Demo House Blend";
const EFFECTIVE_FROM = new Date("2026-09-01T00:00:00.000Z");

interface LineSpec {
  readonly itemCode: string;
  readonly quantity: string;
}

const LINES: readonly LineSpec[] = [
  { itemCode: "DEMO_ESPRESSO_BEANS", quantity: "18.000000" },
  { itemCode: "DEMO_DECAF_BEANS", quantity: "2.000000" },
];

const USAGE = `Usage: npx tsx apps/web/scripts/seed-recipes.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The recipe and its version are reused when present, so re-running is a no-op.
Requires the demo unit/items from \`npm run seed:demo\`.`;

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
  readonly recipeId: string;
  readonly recipeCreated: boolean;
  readonly versionCreated: boolean;
  readonly lineCount: number;
  readonly yieldRate: string;
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

  const unit = await client.pool.query<{ id: string }>(
    "select id from unit where organization_id = $1 and code = $2",
    [organizationId, UNIT_CODE],
  );
  const unitId = unit.rows[0]?.id;
  if (unitId === undefined) {
    return fail(
      `unit ${UNIT_CODE} not found; run \`npm run seed:demo\` first (it creates the demo unit/items)`,
      2,
    );
  }

  const itemIds = new Map<string, string>();
  for (const line of LINES) {
    const item = await client.pool.query<{ id: string }>(
      "select id from item where organization_id = $1 and code = $2",
      [organizationId, line.itemCode],
    );
    const itemId = item.rows[0]?.id;
    if (itemId === undefined) {
      return fail(
        `item ${line.itemCode} not found; run \`npm run seed:demo\` first (it creates the demo unit/items)`,
        2,
      );
    }
    itemIds.set(line.itemCode, itemId);
  }

  const store = createPostgresRecipeStore(client.db);

  let recipeId: string;
  let recipeCreated: boolean;
  const existing = await store.findRecipeByCode(organizationId, RECIPE_CODE);
  if (existing !== undefined) {
    recipeId = existing.id;
    recipeCreated = false;
  } else {
    const registered = await registerRecipe(store, {
      organizationId,
      actorId,
      code: RECIPE_CODE,
      name: RECIPE_NAME,
      // Made-to-order: the demo recipe produces no stocked item (DEC-030).
      outputItemId: null,
    });
    recipeId = registered.recipeId;
    recipeCreated = true;
  }

  const versions = await store.listRecipeVersions(recipeId);
  let versionCreated = false;
  let yieldRate = versions[0]?.yieldRate ?? "0.900000";
  const hasVersionOne = versions.some((version) => version.versionNo === 1);
  if (!hasVersionOne) {
    const registered = await registerRecipeVersion(store, {
      organizationId,
      actorId,
      recipeId,
      versionNo: 1,
      state: "approved",
      plannedInputQty: "20.000000",
      plannedOutputQty: "1.000000",
      approvedUsableOutput: "0.900000",
      effectiveFrom: EFFECTIVE_FROM,
      approvedBy: actorId,
      notes: "Demo seed: house blend, 20 g coffee per portion.",
      lines: LINES.map((line) => ({
        componentKind: "ingredient",
        itemId: itemIds.get(line.itemCode)!,
        quantity: line.quantity,
        unitId,
      })),
    });
    versionCreated = true;
    yieldRate = registered.yieldRate;
  }

  return {
    recipeId,
    recipeCreated,
    versionCreated,
    lineCount: LINES.length,
    yieldRate,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  return [
    `Recipe seed complete for organization ${organizationId}.`,
    `  recipe: ${RECIPE_CODE} (${summary.recipeCreated ? "created" : "exists"})`,
    `  version: v1 (${summary.versionCreated ? "created" : "exists"}) · yield ${summary.yieldRate}`,
    `  lines: ${summary.lineCount}`,
    `  recipe id: ${summary.recipeId}`,
  ].join("\n");
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
  process.stderr.write(`${error instanceof Error ? error.message : "recipe seed failed"}\n`);
  process.exit(1);
});
