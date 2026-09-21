import {
  createImportRun,
  createPostgresImportStore,
  disposeStagingRow,
  getImportRun,
  mapImportRows,
  previewImportRun,
  stageImportRows,
  validateImportRun,
} from "@aquarela/application";
import { createDb, findItemBySku, findOrCreateExternalMapping } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

import { LEGACY_I19_DEMO_TEXT, parseLegacyI19Rows } from "../app/(app)/sales/legacy-i19";

/**
 * Operator command that gives a demo/development install one coherent **import
 * run** end-to-end through the application commands: it registers a file, stages
 * the legacy `I19` reference rows, validates them, maps them to the demo
 * catalogue via `external_mapping`, and dispositions the one row that has no
 * product mapping.
 *
 * Run with `npx tsx apps/web/scripts/seed-imports.ts`. It never creates an
 * organization, user or item: run `npm run bootstrap` and `npm run seed:demo`
 * first. The only rows it creates are the demo `import_profile` for the source
 * (`DEC-081`, the source of the run's version, policy and validation rules) and
 * the two demo `external_mapping`s that link the legacy product names to the
 * demo items (both idempotent by their natural keys).
 *
 * **Reference-only data.** The I19 export is explicitly **not authoritative**
 * (`docs/phase0/SAMPLE_ANALYSIS.md` §9) and the rows are obviously demo.
 *
 * **Idempotency.** The profile is looked up by `(organization_id, source)` and
 * created only when absent, so it is ensured on both the fresh path and a replay
 * without violating the unique key. The run's `file_hash` is deterministic
 * (`seed-imports-i19:<organizationId>`), and the seed only advances a run through
 * the statuses it has not reached yet: a second run finds the run by hash, makes
 * no command call and therefore creates no duplicate run or staging rows.
 *
 * Recorded, not resolved: the run stops at `needs_review`/`validated` — posting
 * is row 12 and owner-gated on `ADR-0008`; `file_object_id` is a real FK
 * (`DEC-085`) but is left null; and no tolerance table exists, so the residual
 * is reported for visibility only.
 * No secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE = "zettle-legacy";
const SOURCE_SYSTEM = "zettle-legacy";
const PROFILE_VERSION = "i19-v1";
const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";
const EFFECTIVE_FROM = new Date("2026-08-01T00:00:00.000Z");
const DISPOSITION_REASON = "legacy product not in the catalogue";

/** The two demo items the legacy product names map onto (`seed-demo`). */
const PRODUCT_MAPPINGS = [
  { product: "Demo Espresso Beans", sku: "DEMO-SKU-ESPRESSO" },
  { product: "Demo Decaf Beans", sku: "DEMO-SKU-DECAF" },
] as const;

const ALLOWED_LOCATIONS = ["Aquarela Kongens Gate", "Aquarela Tullinløkka"] as const;

const USAGE = `Usage: npx tsx apps/web/scripts/seed-imports.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The demo run is found by its deterministic file hash and only advanced through
statuses it has not reached, so re-running is a no-op. Run \`npm run bootstrap\`
and \`npm run seed:demo\` first.`;

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

interface SeedSummary {
  readonly runId: string;
  readonly runExisted: boolean;
  readonly mutated: boolean;
  readonly status: string;
  readonly stagingRowCount: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly dispositionCount: number;
  readonly sourceTotals: Readonly<Record<string, string>>;
  readonly residualTotals: Readonly<Record<string, string>>;
  readonly canClose: boolean;
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

  const parsed = parseLegacyI19Rows(LEGACY_I19_DEMO_TEXT);
  if (parsed.errors.length > 0) {
    return fail(`demo I19 rows did not parse: ${parsed.errors[0]}`, 2);
  }

  const store = createPostgresImportStore(client.db);
  const fileHash = `seed-imports-i19:${organizationId}`;

  let mutated = false;

  // The import profile is the run's source of truth for the version, posting
  // policy and validation rules (`DEC-081`). It is ensured *before* the run
  // lookup so a replay that finds the run still repairs a missing profile, and
  // created only when absent so the `(organization_id, source)` unique key is
  // never violated.
  let profile = await store.findImportProfile({ organizationId, source: SOURCE });
  if (profile === undefined) {
    profile = await store.createImportProfile({
      organizationId,
      source: SOURCE,
      profileVersion: PROFILE_VERSION,
      postingPolicy: "allow_partial",
      validationRules: {
        requiredNormalizedFields: [
          "occurred_at",
          "currency",
          "gross_amount",
          "location_external_id",
        ],
        expectedCurrency: "NOK",
        requireCurrency: true,
        allowedLocationExternalIds: [...ALLOWED_LOCATIONS],
        requireOccurredAt: true,
        requireAmounts: true,
      },
      createdBy: actorId,
    });
    mutated = true;
  }

  let run = await store.findImportRun({ organizationId, fileHash });
  const runExisted = run !== undefined;

  if (run === undefined) {
    // Resolve the demo items and link the legacy product names to them, only on
    // the fresh path: the mapping natural key makes this safe to replay, but a
    // replay writes nothing at all. The mappings are written **before** the run
    // so a crash cannot leave an unmappable run behind.
    for (const mapping of PRODUCT_MAPPINGS) {
      const item = await findItemBySku(client.db, organizationId, mapping.sku);
      if (item === undefined) {
        return fail(`demo item ${mapping.sku} not found; run \`npm run seed:demo\` first`, 2);
      }
      await findOrCreateExternalMapping(client.db, {
        organizationId,
        sourceSystem: SOURCE_SYSTEM,
        entityType: "item",
        externalId: mapping.product,
        sku: item.sku,
        internalEntityType: "item",
        internalEntityId: item.id,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
      });
    }

    const created = await createImportRun(store, {
      organizationId,
      actorId,
      source: SOURCE,
      profileVersion: PROFILE_VERSION,
      fileHash,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    mutated = true;
    run = await store.findImportRun({ organizationId, importRunId: created.importRunId });
  }
  if (run === undefined) {
    return fail("import run could not be created or found", 2);
  }
  const runId = run.id;

  const refresh = async (): Promise<void> => {
    run = await store.findImportRun({ organizationId, importRunId: runId });
  };

  if (run.status === "uploaded") {
    await stageImportRows(store, {
      organizationId,
      actorId,
      importRunId: runId,
      rows: parsed.rows,
    });
    mutated = true;
    await refresh();
  }

  if (run.status === "parsed") {
    await validateImportRun(store, {
      organizationId,
      actorId,
      importRunId: runId,
    });
    mutated = true;
    await refresh();
  }

  const alreadyMapped = typeof run.rowCounts.mapped === "number";
  if ((run.status === "validated" || run.status === "needs_review") && !alreadyMapped) {
    await mapImportRows(store, {
      organizationId,
      actorId,
      importRunId: runId,
      sourceSystem: SOURCE_SYSTEM,
      entityType: "item",
    });
    mutated = true;
    await refresh();
  }

  // A non-posted row without a disposition keeps the run from closing
  // (DEC-035). The seed dispositions only rows it has not decided yet, so a
  // rerun records nothing.
  const detail = await getImportRun(store, { organizationId, importRunId: runId });
  if (detail === undefined) {
    return fail("import run disappeared during the seed", 2);
  }
  const dispositioned = new Set(detail.dispositions.map((disposition) => disposition.stagingRowId));
  for (const row of detail.rows) {
    if (
      row.mappingState === "mapped" ||
      row.mappingState === "ignored" ||
      dispositioned.has(row.id)
    ) {
      continue;
    }
    await disposeStagingRow(store, {
      organizationId,
      actorId,
      importRunId: runId,
      stagingRowId: row.id,
      disposition: "unmapped",
      reason: DISPOSITION_REASON,
    });
    mutated = true;
  }

  const finalDetail = await getImportRun(store, { organizationId, importRunId: runId });
  if (finalDetail === undefined) {
    return fail("import run disappeared during the seed", 2);
  }
  const preview = await previewImportRun(store, { organizationId, importRunId: runId });

  return {
    runId,
    runExisted,
    mutated,
    status: finalDetail.run.status,
    stagingRowCount: finalDetail.rows.length,
    mappedCount: preview.mappedCount,
    unmappedCount: preview.unmappedCount,
    dispositionCount: finalDetail.dispositions.length,
    sourceTotals: preview.sourceTotals ?? {},
    residualTotals: preview.residualTotals ?? {},
    canClose: preview.canClose,
  };
}

function renderTotals(totals: Readonly<Record<string, string>>): string {
  const entries = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? "—"
    : entries.map(([currency, amount]) => `${amount} ${currency}`).join(", ");
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  return [
    `Imports seed complete for organization ${organizationId}.`,
    `  run: ${summary.runId} (${summary.runExisted ? "exists" : "created"}) · status ${summary.status}`,
    `  this run: ${summary.mutated ? "advanced through the commands" : "no writes (idempotent replay)"}`,
    `  staging rows: ${summary.stagingRowCount} (no duplication on rerun)`,
    `  mapped: ${summary.mappedCount} · unmapped: ${summary.unmappedCount} · dispositions: ${summary.dispositionCount}`,
    `  source totals: ${renderTotals(summary.sourceTotals)}`,
    `  residual (source − dispositions; nothing is posted in slice 11): ${renderTotals(summary.residualTotals)}`,
    `  can close: ${summary.canClose ? "yes" : "no"}`,
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
  process.stderr.write(`${error instanceof Error ? error.message : "imports seed failed"}\n`);
  process.exit(1);
});
