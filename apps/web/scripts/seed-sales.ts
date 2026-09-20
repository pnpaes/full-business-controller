import {
  createPostgresConsumptionStore,
  createPostgresReconciliationStore,
  createPostgresSalesStore,
  postImportRun,
  postTheoreticalConsumption,
  reconcileImportRun,
} from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that drives the **row-12** sales/reconciliation path over the
 * run the row-11 seed already staged: it posts the validated import run's rows
 * into `sales_transaction`/`sales_line`, reconciles the run against the posted +
 * dispositioned totals, and posts the day's theoretical consumption.
 *
 * Run with `npx tsx apps/web/scripts/seed-sales.ts`. It never creates an
 * organization, user, item or run: run `npm run bootstrap`, `npm run seed:demo`
 * and the row-11 seed (`npx tsx apps/web/scripts/seed-imports.ts`) first. The run
 * is found by its deterministic `file_hash` (`seed-imports-i19:<organizationId>`).
 *
 * **Idempotency.** Posting only runs when the run is still `validated`/
 * `needs_review`; a `posted`/`partially_posted` run is skipped. `postImportRun`
 * is itself idempotent on the external transaction/line keys, and the day's
 * consumption is keyed per `(location, date, sales_line)`. Re-running therefore
 * adds no transaction, no line and no movement — the summary prints the
 * organization's sales-transaction count so the no-duplication claim is visible.
 *
 * Recorded, not resolved (do not invent a value): there is no tolerance table,
 * so the seed **explicitly opts in** to the published `DEC-026` default via
 * `useDecisionDefaultTolerance` rather than letting a missing tolerance default
 * silently; the legacy I19 profile carries no resolvable `location_id` (the
 * mapping resolves `item` SKUs only — row-11 open point), so the posted
 * transactions have no location and the daily consumption has no
 * recipe-bearing line to explode: it is still exercised and reported honestly as
 * zero consumed lines. No secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Must match `seed-imports.ts`'s deterministic run key. */
const SEED_FILE_HASH_PREFIX = "seed-imports-i19";
const DEMO_LOCATION_CODE = "DEMO_CAFE";
const DEMO_STORAGE_AREA_CODE = "DEMO_DRY";
/** The first business day of the demo run's period (2026-08-01 → 2026-08-31). */
const CONSUMPTION_DAY = "2026-08-01";

const USAGE = `Usage: npx tsx apps/web/scripts/seed-sales.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

Posts, reconciles and consumes the run created by seed-imports.ts. A second run
is a no-op because the run is only posted while it is open and every write is
idempotent. Run \`npm run bootstrap\`, \`npm run seed:demo\` and the row-11
seed first.`;

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

async function queryCount(client: DbClient, text: string, values: unknown[]): Promise<number> {
  const result = await client.pool.query<{ count: string }>(text, values);
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

interface SeedSummary {
  readonly runId: string;
  readonly runStatus: string;
  readonly posted: boolean;
  readonly postedCount: number;
  readonly notPostedCount: number;
  readonly transactionCount: number;
  readonly reconciliationStatus: string;
  readonly expected: string;
  readonly actual: string;
  readonly tolerance: string;
  readonly difference: string;
  readonly reconciliationCreated: boolean;
  readonly consumptionSalesLineCount: number;
  readonly consumptionConsumedLineCount: number;
  readonly consumptionReplayed: boolean;
  readonly salesTransactionTotal: number;
  readonly salesLineTotal: number;
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

  const salesStore = createPostgresSalesStore(client.db);
  const fileHash = `${SEED_FILE_HASH_PREFIX}:${organizationId}`;
  const run = await salesStore.findImportRun({ organizationId, fileHash });
  if (run === undefined) {
    return fail(
      `seeded import run not found (file hash "${fileHash}"); run \`npx tsx apps/web/scripts/seed-imports.ts\` first`,
      2,
    );
  }

  // Posting only while the run is open; a posted run is left as-is so a rerun
  // cannot re-write anything (postImportRun itself is idempotent on the keys).
  let posted = false;
  let postedCount = 0;
  let notPostedCount = 0;
  let transactionCount = 0;
  if (run.status === "validated" || run.status === "needs_review") {
    const result = await postImportRun(salesStore, {
      organizationId,
      actorId,
      importRunId: run.id,
    });
    posted = true;
    postedCount = result.postedCount;
    notPostedCount = result.notPostedCount;
    transactionCount = result.transactionCount;
  } else if (run.status !== "posted" && run.status !== "partially_posted") {
    return fail(
      `import run ${run.id} is ${run.status}; expected validated/needs_review to post or posted/partially_posted to reconcile`,
      2,
    );
  }

  const afterPost = await salesStore.findImportRun({ organizationId, importRunId: run.id });
  const runStatus = afterPost?.status ?? run.status;

  const reconciliationStore = createPostgresReconciliationStore(client.db);
  const reconciliation = await reconcileImportRun(reconciliationStore, {
    organizationId,
    actorId,
    importRunId: run.id,
    // Explicit, visible opt-in to DEC-026's published default: there is no
    // tolerance table, so the default is never applied silently.
    useDecisionDefaultTolerance: true,
  });

  // The daily theoretical consumption is exercised only when seed-demo has run.
  const locationId = await queryId(
    client,
    "select id from location where organization_id = $1 and code = $2",
    [organizationId, DEMO_LOCATION_CODE],
  );
  let consumptionSalesLineCount = 0;
  let consumptionConsumedLineCount = 0;
  let consumptionReplayed = false;
  if (locationId === undefined) {
    return fail(
      `demo location ${DEMO_LOCATION_CODE} not found; run \`npm run seed:demo\` before this seed`,
      2,
    );
  }
  const storageAreaId = await queryId(
    client,
    "select id from storage_area where organization_id = $1 and location_id = $2 and code = $3",
    [organizationId, locationId, DEMO_STORAGE_AREA_CODE],
  );
  if (storageAreaId === undefined) {
    return fail(
      `demo storage area ${DEMO_STORAGE_AREA_CODE} not found; run \`npm run seed:demo\` before this seed`,
      2,
    );
  }
  const consumption = await postTheoreticalConsumption(createPostgresConsumptionStore(client.db), {
    organizationId,
    actorId,
    locationId,
    occurredOn: CONSUMPTION_DAY,
    storageAreaId,
  });
  consumptionSalesLineCount = consumption.salesLineCount;
  consumptionConsumedLineCount = consumption.consumedLineCount;
  consumptionReplayed = consumption.replayed;

  const salesTransactionTotal = await queryCount(
    client,
    "select count(*)::text as count from sales_transaction where organization_id = $1",
    [organizationId],
  );
  const salesLineTotal = await queryCount(
    client,
    "select count(*)::text as count from sales_line where organization_id = $1",
    [organizationId],
  );

  return {
    runId: run.id,
    runStatus,
    posted,
    postedCount,
    notPostedCount,
    transactionCount,
    reconciliationStatus: reconciliation.status,
    expected: reconciliation.expected,
    actual: reconciliation.actual,
    tolerance: reconciliation.tolerance,
    difference: reconciliation.difference,
    reconciliationCreated: reconciliation.created,
    consumptionSalesLineCount,
    consumptionConsumedLineCount,
    consumptionReplayed,
    salesTransactionTotal,
    salesLineTotal,
  };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  return [
    `Sales seed complete for organization ${organizationId}.`,
    `  run: ${summary.runId} · status ${summary.runStatus}`,
    `  posting: ${
      summary.posted
        ? `advanced through postImportRun (${summary.postedCount} posted, ${summary.notPostedCount} not posted, ${summary.transactionCount} transactions created)`
        : "skipped — the run was already posted (idempotent replay)"
    }`,
    `  reconciliation: ${summary.reconciliationStatus} (${summary.reconciliationCreated ? "created" : "updated existing"})`,
    `    expected ${summary.expected} · actual ${summary.actual} · tolerance ${summary.tolerance} · difference ${summary.difference}`,
    `  consumption (${CONSUMPTION_DAY}): ${
      summary.consumptionReplayed ? "replayed" : "posted"
    } — ${summary.consumptionSalesLineCount} sales line(s), ${summary.consumptionConsumedLineCount} consumed`,
    `    (the legacy I19 rows carry no resolvable location_id, so no recipe-bearing line is exploded — recorded row-11/row-12 open point)`,
    `  organization totals (no duplication on rerun): ${summary.salesTransactionTotal} sales transaction(s), ${summary.salesLineTotal} sales line(s)`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "sales seed failed"}\n`);
  process.exit(1);
});
