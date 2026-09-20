import {
  completeProductionBatch,
  createPostgresProductionStore,
  createPostgresRecipeStore,
  createProductionBatch,
  createProductionPlan,
  releaseProductionBatch,
  startProductionBatch,
} from "@aquarela/application";
import { QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install one coherent
 * production batch: a plan header, a batch planned against the existing approved
 * `DEMO_HOUSE_BLEND` recipe version (from `seed-recipes`), and its release →
 * start → completion, all **through the application commands**, so the planned
 * snapshot, the yield variance and the ledger postings are exercised end-to-end.
 *
 * Run with `npx tsx apps/web/scripts/seed-production.ts`. It never creates an
 * organization, user, unit, location, storage area or recipe: run
 * `npm run bootstrap`, `npm run seed:demo` and the recipe seed first. The one
 * master row it does create is the demo **output item** the recipe is missing:
 * `seed-recipes` registers `DEMO_HOUSE_BLEND` as made-to-order (`outputItemId:
 * null`, DEC-030), but production requires a **stocked** output item (PROD-001),
 * so this seed attaches an obviously-demo `DEMO_HOUSE_BLEND` finished good when
 * the recipe has none. It never overwrites an output item that is already set.
 *
 * Everything is keyed on deterministic plan/batch ids (the only idempotency path
 * — `production_batch` has no natural key, open point (a)) and a deterministic
 * completion idempotency key, so a second run replays and reports instead of
 * duplicating. A partially-completed first run converges on the next run.
 *
 * Recorded open points it deliberately does not work around: no batch number
 * (idempotency is a caller-supplied id); `DEC-036` partial portions are
 * unsupported (base-unit quantities only); multi-output cost allocation is
 * undefined (single output); no WIP/source-draw area (the seed supplies the
 * storage area explicitly); no yield tolerance/exception store.
 *
 * Values are obviously demo (`Demo …`) and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_CODE = "DEMO_CAFE";
const AREA_CODE = "DEMO_DRY";
const UNIT_CODE = "DEMO_G";
const RECIPE_CODE = "DEMO_HOUSE_BLEND";
const RECIPE_VERSION_NO = 1;
const OUTPUT_ITEM_CODE = "DEMO_HOUSE_BLEND";
const OUTPUT_ITEM_SKU = "DEMO-SKU-BLEND";
const OUTPUT_ITEM_NAME = "Demo House Blend";

/** Deterministic ids: the idempotency keys for the whole seed. */
const DEMO_PLAN_ID = "30000000-0000-4000-8000-000000000001";
const DEMO_BATCH_ID = "30000000-0000-4000-8000-000000000002";
const DEMO_COMPLETION_KEY = "seed-production-complete";
const DEMO_PRODUCTION_DATE = "2026-09-20";
const DEMO_PLANNED_START = "2026-09-20T08:00:00.000Z";
/** Deterministic demo variance on the first input line (0.5 in its base unit). */
const DEMO_INPUT_VARIANCE = 500_000n;

const USAGE = `Usage: npx tsx apps/web/scripts/seed-production.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The plan, batch and completion are replayed when present, so re-running is a
no-op. Run \`npm run bootstrap\`, \`npm run seed:demo\` and the recipe seed first.`;

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

async function queryId(
  client: DbClient,
  text: string,
  values: unknown[],
): Promise<string | undefined> {
  const result = await client.pool.query<{ id: string }>(text, values);
  return result.rows[0]?.id;
}

/** `planned − delta`, floored at zero so the demo actual is never negative. */
function adjustedQty(planned: string): string {
  const base = parseDecimal(planned, QUANTITY_SCALE);
  const next = base - DEMO_INPUT_VARIANCE;
  return formatDecimal(next < 0n ? 0n : next, QUANTITY_SCALE);
}

interface SeedSummary {
  readonly outputItemCreated: boolean;
  readonly outputItemLinked: boolean;
  readonly planId: string;
  readonly planReplayed: boolean;
  readonly batchId: string;
  readonly batchReplayed: boolean;
  readonly batchStatus: string;
  readonly actualOutputQty: string | null;
  readonly yieldVariancePct: string | null;
}

async function seed(client: DbClient, organizationId: string): Promise<SeedSummary> {
  const organization = await queryId(client, "select id from organization where id = $1", [
    organizationId,
  ]);
  if (organization === undefined) {
    return fail(
      `organization ${organizationId} does not exist; run \`npm run bootstrap\` first`,
      2,
    );
  }

  const actorId = await queryId(
    client,
    "select id from app_user where organization_id = $1 and status = 'active' order by id limit 1",
    [organizationId],
  );
  if (actorId === undefined) {
    return fail(
      `no active app_user in organization ${organizationId}; run \`npm run bootstrap\` first`,
      2,
    );
  }

  const locationId = await queryId(
    client,
    "select id from location where organization_id = $1 and code = $2",
    [organizationId, LOCATION_CODE],
  );
  if (locationId === undefined) {
    return fail(`demo location ${LOCATION_CODE} not found; run \`npm run seed:demo\` first`, 2);
  }

  const unitId = await queryId(
    client,
    "select id from unit where organization_id = $1 and code = $2",
    [organizationId, UNIT_CODE],
  );
  if (unitId === undefined) {
    return fail(`unit ${UNIT_CODE} not found; run \`npm run seed:demo\` first`, 2);
  }

  const store = createPostgresProductionStore(client.db);
  const area = await store.findStorageAreaByCode({
    organizationId,
    locationId,
    code: AREA_CODE,
  });
  if (area === undefined) {
    return fail(`storage area ${AREA_CODE} not found; run \`npm run seed:demo\` first`, 2);
  }

  // The existing approved recipe version (`seed-recipes`). Its output item must
  // be a stocked item for production; the demo recipe is registered with none.
  const recipeStore = createPostgresRecipeStore(client.db);
  const recipe = await recipeStore.findRecipeByCode(organizationId, RECIPE_CODE);
  if (recipe === undefined) {
    return fail(
      `recipe ${RECIPE_CODE} not found; run the recipe seed (\`seed-recipes.ts\`) first`,
      2,
    );
  }
  const version = (await recipeStore.listRecipeVersions(recipe.id)).find(
    (candidate) => candidate.versionNo === RECIPE_VERSION_NO,
  );
  if (version === undefined) {
    return fail(
      `recipe ${RECIPE_CODE} has no version ${RECIPE_VERSION_NO}; run the recipe seed first`,
      2,
    );
  }
  if (version.state !== "approved") {
    return fail(
      `recipe version ${RECIPE_CODE} v${RECIPE_VERSION_NO} is "${version.state}", not approved (PROD-001)`,
      2,
    );
  }

  // Ensure the demo output item exists (a stocked finished good in the demo unit).
  let outputItemCreated = false;
  let outputItemId = await queryId(
    client,
    "select id from item where organization_id = $1 and code = $2",
    [organizationId, OUTPUT_ITEM_CODE],
  );
  if (outputItemId === undefined) {
    await client.pool.query(
      `insert into item
        (organization_id, code, sku, name, item_type, base_unit_id, inventory_policy, lot_tracked)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        OUTPUT_ITEM_CODE,
        OUTPUT_ITEM_SKU,
        OUTPUT_ITEM_NAME,
        "finished_good",
        unitId,
        "stocked",
        true,
      ],
    );
    outputItemId = await queryId(
      client,
      "select id from item where organization_id = $1 and code = $2",
      [organizationId, OUTPUT_ITEM_CODE],
    );
    outputItemCreated = true;
  }
  if (outputItemId === undefined) {
    return fail(`could not create or find the demo output item ${OUTPUT_ITEM_CODE}`, 2);
  }

  // Attach the output item only when the recipe has none; never overwrite a
  // deliberately-set output item.
  let outputItemLinked = false;
  if (recipe.outputItemId === null) {
    await client.pool.query(
      "update recipe set output_item_id = $1 where id = $2 and organization_id = $3 and output_item_id is null",
      [outputItemId, recipe.id, organizationId],
    );
    outputItemLinked = true;
  } else if (recipe.outputItemId !== outputItemId) {
    outputItemId = recipe.outputItemId;
  }
  const linkedItem = await store.findItem(outputItemId);
  if (linkedItem === undefined || linkedItem.organizationId !== organizationId) {
    return fail(`recipe ${RECIPE_CODE} output item ${outputItemId} is not in this organization`, 2);
  }
  if (linkedItem.inventoryPolicy !== "stocked") {
    return fail(
      `recipe ${RECIPE_CODE} output item ${linkedItem.code} is "${linkedItem.inventoryPolicy}", not stocked (PROD-001)`,
      2,
    );
  }

  const plan = await createProductionPlan(store, {
    organizationId,
    actorId,
    locationId,
    productionDate: DEMO_PRODUCTION_DATE,
    productionPlanId: DEMO_PLAN_ID,
  });

  // The deterministic batch id replays an existing batch; the returned planned
  // snapshot is then reused for the actuals, so a rerun converges.
  const planned = await createProductionBatch(store, {
    organizationId,
    actorId,
    locationId,
    recipeVersionId: version.id,
    planId: plan.productionPlanId,
    workstation: "bar",
    plannedStart: DEMO_PLANNED_START,
    destinationStorageAreaId: area.id,
    productionBatchId: DEMO_BATCH_ID,
  });

  let status = planned.status;
  if (status === "planned") {
    await releaseProductionBatch(store, {
      organizationId,
      actorId,
      productionBatchId: planned.productionBatchId,
    });
    status = "released";
  }
  if (status === "released") {
    await startProductionBatch(store, {
      organizationId,
      actorId,
      productionBatchId: planned.productionBatchId,
      actualStart: DEMO_PLANNED_START,
    });
    status = "in_progress";
  }

  const outputLine = planned.plannedOutputs[0];
  if (outputLine === undefined) {
    return fail(`recipe ${RECIPE_CODE} produced no planned output line`, 2);
  }

  let actualOutputQty: string | null = null;
  let yieldVariancePct: string | null = null;
  if (status === "in_progress") {
    const completed = await completeProductionBatch(store, {
      organizationId,
      actorId,
      productionBatchId: planned.productionBatchId,
      actualFinish: "2026-09-20T08:30:00.000Z",
      inputStorageAreaId: area.id,
      inputs: planned.plannedInputs.map((line, index) => ({
        itemId: line.itemId,
        actualQty: index === 0 ? adjustedQty(line.plannedQty) : line.plannedQty,
        ...(index === 0 ? { reasonCode: "seed demo variance" } : {}),
      })),
      output: {
        itemId: outputLine.itemId,
        actualQty: planned.plannedOutputQty,
      },
      idempotencyKey: DEMO_COMPLETION_KEY,
    });
    actualOutputQty = completed.actualOutputQty;
    yieldVariancePct = completed.yieldVariancePct;
    status = completed.status;
  } else if (status === "completed") {
    const existing = await store.findProductionBatch({
      organizationId,
      productionBatchId: planned.productionBatchId,
    });
    actualOutputQty = existing?.actualOutputQty ?? null;
    yieldVariancePct = existing?.yieldVariancePct ?? null;
  }

  return {
    outputItemCreated,
    outputItemLinked,
    planId: plan.productionPlanId,
    planReplayed: plan.replayed,
    batchId: planned.productionBatchId,
    batchReplayed: planned.replayed,
    batchStatus: status,
    actualOutputQty,
    yieldVariancePct,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  return [
    `Production seed complete for organization ${organizationId}.`,
    `  output item ${OUTPUT_ITEM_CODE}: ${summary.outputItemCreated ? "created" : "exists"}${
      summary.outputItemLinked ? " · linked to the recipe" : ""
    }`,
    `  plan: ${summary.planId} (${summary.planReplayed ? "exists" : "created"})`,
    `  batch: ${summary.batchId} (${summary.batchReplayed ? "exists" : "created"}) · status ${summary.batchStatus}`,
    `  output: ${summary.actualOutputQty ?? "—"}${summary.yieldVariancePct === null ? "" : ` · yield variance ${summary.yieldVariancePct}`}`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "production seed failed"}\n`);
  process.exit(1);
});
