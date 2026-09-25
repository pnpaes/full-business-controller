import {
  createPostgresIntegrationSourceStore,
  registerIntegrationSource,
} from "@aquarela/application";
import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

/**
 * Operator command that gives a demo/development install the six integration
 * sources from the `INTG-001`/`DEC-137` read-only registry: Frontline POS, Wolt,
 * Foodora, Medusa, Sanity and Fiken. Every source is **read-only** — `direction
 * read`, `terms_status pending`, no allowed operations — which is the only
 * enabled posture today (`ADR-0011`; publishing execution stays deferred on
 * `ADR-0004`). Each source is registered through the **application** command, so
 * the field validation, the `DEC-015` write-requires-approved-terms guard and
 * the audit fact are exercised end-to-end.
 *
 * Run with `npx tsx apps/web/scripts/seed-integrations.ts`. It never creates an
 * organization or a user: the organization must already exist (from
 * `npm run bootstrap`, whose owner is used as the acting user). Every source is
 * keyed on its organization-unique name, and existence is checked before
 * registering, so a second run is a no-op.
 *
 * **Fiken**: the accountant (`FIN`) owns its credentials. Its intended
 * `write_accounting` operation is enabled later, once the accountant approves
 * the terms — a write operation cannot be stored while `terms_status` is
 * `pending` (the `DEC-015` database check), so this seed registers Fiken
 * read-only and leaves the write operation to that later approval.
 *
 * Values are obviously demo and no secret is read, printed or stored.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SourceSeed {
  readonly name: string;
  readonly systemType: string;
  readonly credentialsOwner: string;
}

const SOURCES: readonly SourceSeed[] = [
  { name: "Frontline POS", systemType: "pos", credentialsOwner: "TECH" },
  { name: "Wolt", systemType: "wolt", credentialsOwner: "TECH" },
  { name: "Foodora", systemType: "other", credentialsOwner: "TECH" },
  { name: "Medusa", systemType: "medusa", credentialsOwner: "TECH" },
  { name: "Sanity", systemType: "sanity", credentialsOwner: "TECH" },
  { name: "Fiken", systemType: "fiken", credentialsOwner: "FIN" },
];

const USAGE = `Usage: npx tsx apps/web/scripts/seed-integrations.ts [options]

Required (flag or env):
  --database-url <url>     DATABASE_URL (postgres://…)
  --organization-id <uuid> ORGANIZATION_ID (the existing bootstrap/demo org)

Optional:
  --help

The six read-only integration sources are reused when present, so re-running is
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

  const store = createPostgresIntegrationSourceStore(client.db);
  const entities: EntityLine[] = [];

  for (const source of SOURCES) {
    const existing = await store.findIntegrationSourceByName(organizationId, source.name);
    if (existing !== undefined) {
      entities.push({ kind: "integration source", code: source.name, created: false });
      continue;
    }
    await registerIntegrationSource(store, {
      organizationId,
      actorId,
      name: source.name,
      systemType: source.systemType,
      direction: "read",
      allowedOperations: [],
      credentialsOwner: source.credentialsOwner,
      rateLimitNote: null,
      termsStatus: "pending",
      active: true,
    });
    entities.push({ kind: "integration source", code: source.name, created: true });
  }

  return { entities };
}

function renderSummary(organizationId: string, summary: SeedSummary): string {
  const lines = [`Integrations seed complete for organization ${organizationId}.`];
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
  process.stderr.write(`${error instanceof Error ? error.message : "integrations seed failed"}\n`);
  process.exit(1);
});
